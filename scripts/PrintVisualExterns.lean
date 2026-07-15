import GameServer.Tactic.Visual
import Lean.Compiler.ExternAttr
import Lean.Compiler.IR.CompilerM
import Lean.Compiler.NameMangling
import Lean.Elab.Command

open Lean Elab Command

/--
Write the Emscripten export spellings for every ad-hoc native external
declaration visible to the Visual tactic environment.  Explicit C externs use
runtime symbols such as `lean_*`; the runtime generator retains those directly.
Ad-hoc externs instead use Lean-mangled `l_*` symbols and must be discovered
from the elaborated environment rather than guessed from source text.
-/

elab "write_visual_externs" : command => do
  let env ← getEnv
  let mut symbols : Array String := #[]
  for moduleName in env.header.moduleNames do
    let some moduleIdx := env.getModuleIdx? moduleName | continue
    for decl in unsafe IR.declMapExt.getModuleIREntries env moduleIdx do
      if let IR.Decl.extern name _ _ _ := decl then
        let stem := name.mangle
        symbols := symbols.push s!"_{stem}"
        symbols := symbols.push s!"_{mkMangledBoxedName stem}"
  symbols := symbols.qsort (· < ·)
  IO.FS.writeFile "../.visual-link/visual-externs.txt" s!"{String.intercalate "\n" symbols.toList}\n"

write_visual_externs
