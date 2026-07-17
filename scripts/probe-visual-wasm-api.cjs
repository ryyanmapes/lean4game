#!/usr/bin/env node

// Exercise the same exported API sequence as the browser worker. Running Lean
// through main() is insufficient: the browser loads a header snapshot into
// the shell cache and then calls lean_wasm_compile repeatedly in one process.

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const [runtimeDir, workDir] = process.argv.slice(2)
if (!runtimeDir || !workDir) {
  console.error('usage: probe-visual-wasm-api.cjs <runtime-dir> <work-dir>')
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

const diagnostics = []
globalThis.Module = {
  noInitialRun: true,
  print(text) {
    try { diagnostics.push(JSON.parse(String(text))) } catch { /* debug output */ }
  },
  printErr: text => console.error(text),
  preRun: [function () {
    const { FS } = Module
    for (const directory of ['/lib/lean', '/work', '/bin', '/workspace']) mkdirTree(FS, directory)
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

      const loadStatus = ioUInt32(
        Module._lean_wasm_load_snapshot(mkLeanString('/work/game.snap')),
        'lean_wasm_load_snapshot',
      )
      if (loadStatus !== 0) throw new Error(`snapshot load returned ${loadStatus}`)

      const prefix = 'import GameServer.Tactic.Visual\n\nexample (P : Prop) : P → P := by\n'
      diagnostics.length = 0
      ioUInt32(Module._lean_wasm_compile(
        mkLeanString(`${prefix}  skip\n  all_goals browser_report_state\n  all_goals sorry\n`),
        mkLeanString('/work/incomplete.lean'),
      ), 'first lean_wasm_compile')
      const stateMarker = '__VISUAL_LEAN_STATE_V1__'
      const stateDiagnostic = diagnostics.find(diagnostic => (diagnostic.data ?? '').includes(stateMarker))
      if (!stateDiagnostic) {
        throw new Error(`incomplete proof did not produce structured state: ${JSON.stringify(diagnostics)}`)
      }
      const stateJson = stateDiagnostic.data.slice(stateDiagnostic.data.indexOf(stateMarker) + stateMarker.length)
      const state = JSON.parse(stateJson)
      if (state.goal?.clickAction?.playTactic !== 'click_goal' || state.goal?.hyps?.[0]?.type?.text !== 'Prop') {
        throw new Error(`structured state has unexpected content: ${JSON.stringify(state)}`)
      }

      diagnostics.length = 0
      const status = ioUInt32(
        Module._lean_wasm_compile(
          mkLeanString(`${prefix}  click_goal\n  exact h\n`),
          mkLeanString('/work/click-goal.lean'),
        ),
        'second lean_wasm_compile',
      )
      if (status !== 0) {
        throw new Error(`click_goal compile returned ${status}: ${JSON.stringify(diagnostics)}`)
      }
      if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
        throw new Error(`click_goal emitted errors: ${JSON.stringify(diagnostics)}`)
      }

      if (process.env.PROBE_NNG4 === 'true') {
        diagnostics.length = 0
        const nngStatus = ioUInt32(
          Module._lean_wasm_compile(
            mkLeanString(
              'import Game.Levels.Tutorial.L01rfl\n\n' +
              'example (x q : MyNat) : 37 * x + q = 37 * x + q := by\n' +
              '  rfl\n',
            ),
            mkLeanString('/work/nng4-tutorial.lean'),
          ),
          'NNG4 lean_wasm_compile',
        )
        if (nngStatus !== 0 || diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
          throw new Error(`NNG4 persistent compile failed: ${JSON.stringify(diagnostics)}`)
        }
      }
      console.log('browser API probe passed')
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
