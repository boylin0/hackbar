#!/usr/bin/env node

const child_process = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const buildDir = execEnv.buildDir
const packageJsonPath = path.join(buildDir, 'package.json')
const packageLockPath = path.join(buildDir, 'package-lock.json')
const generatorsDir = path.join(buildDir, 'src', 'generators')

// Tool packages installed temporarily while this generator runs
const toolPackages = ['tar@7.5.16', 'diff@9.0.0']

const projectDir = process.env.PROJECT_CWD
const tarballPath = path.join(
  projectDir,
  'build',
  'package-generators',
  'curlconverter',
  'curlconverter-4.11.0.tgz',
)
const packageLockSourcePath = path.join(
  projectDir,
  'build',
  'package-generators',
  'curlconverter',
  'package-lock.json',
)
const patchPath = path.join(
  projectDir,
  'build',
  'package-generators',
  'curlconverter',
  'curlconverter.patch',
)

process.on('uncaughtException', err => {
  if (err.stdout?.length) {
    console.error(`stdout: ${err.stdout}\n`)
  }
  if (err.stderr?.length) {
    console.error(`stderr: ${err.stderr}\n`)
  }

  throw err
})

// npm ships as npm.cmd on Windows and only resolves through a shell.
const isWindows = process.platform === 'win32'
const npm = isWindows ? 'npm.cmd' : 'npm'
const npmOptions = { cwd: buildDir, shell: isWindows }

// Yarn runs this generator during its resolution step, before node_modules
// exists, so the tar/diff libraries are installed into a throwaway dir and
// loaded from there.
const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curlconverter-tools-'))
child_process.execFileSync(
  npm,
  [
    'install',
    '--prefix',
    toolsDir,
    '--no-save',
    '--no-package-lock',
    ...toolPackages,
  ],
  { cwd: toolsDir, shell: isWindows },
)
const tar = require(path.join(toolsDir, 'node_modules', 'tar'))
const diff = require(path.join(toolsDir, 'node_modules', 'diff'))

// Prepare source files
tar.x({ file: tarballPath, cwd: buildDir, strip: 1, sync: true })
fs.cpSync(packageLockSourcePath, packageLockPath)

// Remove all generators except json
for (const file of fs.readdirSync(generatorsDir)) {
  if (file !== 'json.ts') {
    fs.rmSync(path.join(generatorsDir, file), { recursive: true, force: true })
  }
}
fs.writeFileSync(
  path.join(buildDir, 'src/index.ts'),
  'export { toJsonString } from "./generators/json.js";',
)

// Patch packages with jsdiff
diff.applyPatches(fs.readFileSync(patchPath, 'utf8'), {
  loadFile(patch, callback) {
    const rel = (patch.oldFileName || patch.newFileName).replace(/^[ab]\//, '')
    callback(null, fs.readFileSync(path.join(buildDir, rel), 'utf8'))
  },
  patched(patch, content, callback) {
    if (content === false) {
      callback(new Error(`patch failed for ${patch.oldFileName}`))
      return
    }
    const rel = (patch.newFileName || patch.oldFileName).replace(/^[ab]\//, '')
    fs.writeFileSync(path.join(buildDir, rel), content)
    callback()
  },
  complete(err) {
    if (err) throw err
  },
})

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
delete packageJson.bin
delete packageJson.browser
delete packageJson.dependencies['@curlconverter/tree-sitter']
delete packageJson.scripts.prepare
packageJson.dependencies.nan = '^2.22.0'
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))

for (const target of [
  'dist/src',
  'tools',
  'src/shell/Parser.ts',
  'src/cli.ts',
]) {
  fs.rmSync(path.join(buildDir, target), { recursive: true, force: true })
}

// Prepare package
child_process.execFileSync(npm, ['install'], npmOptions)

// Build package
child_process.execFileSync(npm, ['run', 'compile'], npmOptions)

// Cleanup
fs.rmSync(path.join(buildDir, 'node_modules'), { recursive: true, force: true })
fs.rmSync(toolsDir, { recursive: true, force: true })
