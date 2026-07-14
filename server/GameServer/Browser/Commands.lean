import Lean.Elab.Command
import GameServer.Tactic.Click

/-!
Browser-only command surface for games.

The native game build uses `GameServer.Commands` to collect metadata, compute
inventories, and write game-data JSON. Browser WASM already receives that JSON
as a packaged asset, so importing a game only needs enough command syntax to
elaborate level files and check their sample proofs.
-/

namespace GameServer

open Lean Elab Command

syntax visualBool := &"true" <|> &"false"
syntax preambleArg := atomic(" (" &"preamble" " := " withoutPosition(tacticSeq) ")")

elab "Game" _n:str : command => pure ()
elab "World" _n:str : command => pure ()
elab "Level" _level:num : command => pure ()
elab "Title" _t:str : command => pure ()
elab "Introduction" _t:str : command => pure ()
elab "Conclusion" _t:str : command => pure ()
elab "Info" _t:str : command => pure ()
elab "Image" _t:str : command => pure ()
elab "Prerequisites" _t:str* : command => pure ()
elab "CaptionShort" _t:str : command => pure ()
elab "CaptionLong" _t:str : command => pure ()
elab "Languages" _t:str* : command => pure ()
elab "CoverImage" _t:str : command => pure ()

elab _doc:docComment ? "TacticDoc" _name:ident _inArg?:((" in " str)?) _content:str ? :
    command => pure ()
elab _doc:docComment ? "TheoremDoc" _name:ident "as" _displayName:str
    _inArg?:((" in " str)?) _content:str ? : command => pure ()
elab _doc:docComment ? "DefinitionDoc" _name:ident "as" _displayName:str
    _inArg?:((" in " str)?) _content:str ? : command => pure ()

elab "NewTactic" _args:ident* : command => pure ()
elab "NewTheorem" _args:ident* : command => pure ()
elab "NewLemma" _args:ident* : command => pure ()
elab "NewDefinition" _args:ident* : command => pure ()
elab "OnlyTactic" _args:ident* : command => pure ()
elab "OnlyTheorem" _args:ident* : command => pure ()
elab "OnlyLemma" _args:ident* : command => pure ()
elab "OnlyDefinition" _args:ident* : command => pure ()
elab "DisabledTactic" _args:ident* : command => pure ()
elab "DisabledTheorem" _args:ident* : command => pure ()
elab "DisabledLemma" _args:ident* : command => pure ()
elab "DisabledDefinition" _args:ident* : command => pure ()
elab "HiddenTactic" _args:ident* : command => pure ()
elab "HiddenTheorem" _args:ident* : command => pure ()
elab "HiddenLemma" _args:ident* : command => pure ()
elab "HiddenDefinition" _args:ident* : command => pure ()

elab "VisualSkipLevel" : command => pure ()
elab "VisualLevelNumber" _label:str : command => pure ()
elab "VisualColorScheme" _color:ident : command => pure ()
elab "VisualDramaticStart" : command => pure ()
elab "VisualEmphasize" _name:ident : command => pure ()
elab "VisualUnlockTactic" _args:ident* : command => pure ()
elab "VisualGoalInfo " _pos:ident _arrow:visualBool _text:str : command => pure ()
elab "VisualGoalInfoOnGoal " _pos:ident &"true" _goalText:str &"show" _text:str :
    command => pure ()
elab "VisualGoalInfoOnGoal " _pos:ident &"false" _goalText:str &"show" _text:str :
    command => pure ()
elab "VisualGoalInfoOnGoalWithHyp " _pos:ident _arrow:visualBool _goalText:str
    _hypType:str &"show" _text:str : command => pure ()
elab "VisualGoalInfoOnGoalWithoutHyp " _pos:ident _arrow:visualBool _goalText:str
    _hypType:str &"show" _text:str : command => pure ()
elab "VisualTransformSideInfo " _side:ident _text:str : command => pure ()
elab "VisualTransformSideInfoOnGoal " _side:ident _goalText:str &"show" _text:str :
    command => pure ()
elab "VisualTransformRewriteInfo " _source:ident _target:str _text:str : command => pure ()
elab "VisualTransformRewriteInfoOnGoal " _source:ident _target:str _goalText:str
    &"show" _text:str : command => pure ()
elab "VisualTransformBackInfoOnGoal " _goalText:str &"show" _text:str : command => pure ()
elab "VisualTransformReverseInfoOnGoal " _goalText:str &"show" _text:str : command => pure ()
elab "VisualTransformInfoOnGoal " _goalText:str &"show" _text:str : command => pure ()
elab "VisualTacticHypInfo " _tactic:ident _hyp:ident _text:str : command => pure ()
elab "VisualTacticHypInfoOnGoal " _tactic:ident _hyp:ident _goalText:str
    &"show" _text:str : command => pure ()
elab "VisualHypGoalInfo " _hyp:ident _text:str : command => pure ()
elab "VisualHypGoalInfoOnGoal " _hyp:ident _goalText:str &"show" _text:str :
    command => pure ()
elab "VisualProofGraphInfo " _text:str : command => pure ()
elab "VisualProofGraphInfoOnGoal " _goalText:str &"show" _text:str : command => pure ()

elab _doc:docComment ? "Statement" _statementName:ident ? _preamble:preambleArg ?
    sig:declSig val:declVal : command => do
  match val with
  | `(Parser.Command.declVal| := by $proof:tacticSeq) =>
      let declName := mkIdent ((← getMainModule) ++ `_browser_statement)
      elabCommand (← `(theorem $declName:ident $sig:declSig := by $proof:tacticSeq))
  | _ =>
      throwError "browser Statement shim expects `:= by ...`"

elab "MakeGame" : command => pure ()

end GameServer
