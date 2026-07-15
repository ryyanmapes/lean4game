prelude

/-!
Persistent browser wrapper for Cauli Lean's in-memory compiler.

`Lean.wasmCompile` returns `1` when elaboration emits errors. Its exported
`IO UInt32` entry point is process-shaped, so Emscripten interprets that value
as `exit(1)`. In the game, incomplete proofs intentionally emit `unsolved
goals`; those diagnostics are the next visual proof state and must not end the
long-lived worker.

This wrapper preserves every diagnostic and propagates real IO failures, but
maps the ordinary elaboration status to process status zero. The client still
accepts or rejects proof moves exclusively from Lean's emitted diagnostics.
-/

namespace GameServer.Browser

@[extern "lean_wasm_compile"]
opaque cauliWasmCompile (code : @& String) (fileName : @& String) : IO UInt32

@[export visual_lean_wasm_compile]
def wasmCompile (code : String) (fileName : String := "<input>") : IO UInt32 := do
  discard <| cauliWasmCompile code fileName
  return 0

end GameServer.Browser
