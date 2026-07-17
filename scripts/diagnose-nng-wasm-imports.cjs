#!/usr/bin/env node

// Locate a legacy module whose initializer is unavailable to Lean's WASM IR
// interpreter. Keep one runtime alive so the large core environment is reused
// while progressively probing the NNG import closure.

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const [runtimeDir, workDir] = process.argv.slice(2)
if (!runtimeDir || !workDir) {
  console.error('usage: diagnose-nng-wasm-imports.cjs <runtime-dir> <work-dir>')
  process.exit(2)
}

const leanJs = path.resolve(runtimeDir, 'bin/lean.js')
const libLean = path.resolve(runtimeDir, 'lib/lean')
const realWork = path.resolve(workDir)
process.chdir('/')

function mkdirTree(FS, target) {
  let current = ''
  for (const part of target.split('/').filter(Boolean)) {
    current += `/${part}`
    try { FS.mkdir(current) } catch { /* already exists */ }
  }
}

function mkLeanString(value) {
  const pointer = Module.stringToNewUTF8(value)
  const string = Module._lean_mk_string(pointer)
  Module._free(pointer)
  return string
}

function ioUInt32(result, operation) {
  const tag = Module.getValue(result + 7, 'i8') & 0xff
  if (tag !== 0) throw new Error(`${operation} returned an IO error`)
  const boxed = Module.getValue(result + 8, 'i32')
  return Module.getValue(boxed + 8, 'i32') >>> 0
}

function checkIO(result, operation) {
  const tag = Module.getValue(result + 7, 'i8') & 0xff
  if (tag !== 0) throw new Error(`${operation} returned an IO error`)
}

const imports = [
  'I18n',
  'GameServer.Commands',
  'Mathlib.Tactic.Cases',
  'Mathlib.Tactic.Tauto',
  'Game.Metadata',
  'Game.Levels.Tutorial',
  'Game.Levels.AdvMultiplication',
  'Game',
]
let diagnostics = []

globalThis.Module = {
  noInitialRun: true,
  print(text) {
    try { diagnostics.push(JSON.parse(String(text))) } catch { /* progress */ }
  },
  printErr: text => console.error(text),
  preRun: [function () {
    const { FS } = Module
    for (const directory of ['/lib/lean', '/work', '/bin']) mkdirTree(FS, directory)
    mkdirTree(FS, path.dirname(leanJs))
    FS.mount(FS.filesystems.NODEFS, { root: libLean }, '/lib/lean')
    FS.mount(FS.filesystems.NODEFS, { root: realWork }, '/work')
    Module.ENV.LEAN_PATH = '/lib/lean'
    FS.chdir('/work')
  }],
  onRuntimeInitialized() {
    try {
      Module._lean_initialize_runtime_module()
      Module._lean_initialize()
      Module._lean_io_mark_end_initialization()
      if (Module._lean_init_task_manager) Module._lean_init_task_manager()
      Module.runtimeKeepalivePush()
      if (Module._lean_enable_initializer_execution) Module._lean_enable_initializer_execution()
      checkIO(Module._lean_init_search_path(), 'lean_init_search_path')

      for (const [index, moduleName] of imports.entries()) {
        console.log(`WASM import probe ${index + 1}/${imports.length}: ${moduleName}`)
        diagnostics = []
        const status = ioUInt32(
          Module._lean_wasm_compile(
            mkLeanString(`import ${moduleName}\n\nexample : True := True.intro\n`),
            mkLeanString(`/work/import-${index}.lean`),
          ),
          `import ${moduleName}`,
        )
        const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
        if (status !== 0 || errors.length > 0) {
          throw new Error(`import ${moduleName} failed (${status}): ${JSON.stringify(errors)}`)
        }
      }

      console.log('all staged NNG WASM imports passed')
      setImmediate(() => process.exit(0))
    } catch (error) {
      console.error(error)
      setImmediate(() => process.exit(1))
    }
  },
  onAbort(what) {
    console.error('ABORT:', what)
    setImmediate(() => process.exit(1))
  },
}

globalThis.require = require
globalThis.__filename = leanJs
globalThis.__dirname = path.dirname(leanJs)
vm.runInThisContext(fs.readFileSync(leanJs, 'utf8'), { filename: leanJs })
