import Lean.Parser
import GameServer.Tactic.Click

/-!
Browser-only command surface for games.

The native game build uses `GameServer.Commands` to collect metadata, compute
inventories, and write game-data JSON. Browser WASM already receives that JSON
as a packaged asset, so importing a game only needs enough command syntax to
elaborate level files and check their sample proofs.

Keep this module deliberately parser/macro-only. Importing `Lean.Elab.Command`
pulls in most of the Lean frontend, which makes browser startup much larger.
-/

namespace GameServer

syntax visualBool := &"true" <|> &"false"

macro "Game" str : command => `(command| set_option linter.unusedVariables false)
macro "World" str : command => `(command| set_option linter.unusedVariables false)
macro "Level" num : command => `(command| set_option linter.unusedVariables false)
macro "Title" str : command => `(command| set_option linter.unusedVariables false)
macro "Introduction" str : command => `(command| set_option linter.unusedVariables false)
macro "Conclusion" str : command => `(command| set_option linter.unusedVariables false)
macro "Info" str : command => `(command| set_option linter.unusedVariables false)
macro "Image" str : command => `(command| set_option linter.unusedVariables false)
macro "Prerequisites" str* : command => `(command| set_option linter.unusedVariables false)
macro "CaptionShort" str : command => `(command| set_option linter.unusedVariables false)
macro "CaptionLong" str : command => `(command| set_option linter.unusedVariables false)
macro "Languages" str* : command => `(command| set_option linter.unusedVariables false)
macro "CoverImage" str : command => `(command| set_option linter.unusedVariables false)

macro (docComment)? "TacticDoc" ident (" in " str)? (str)? : command =>
  `(command| set_option linter.unusedVariables false)
macro (docComment)? "TheoremDoc" ident "as" str (" in " str)? (str)? : command =>
  `(command| set_option linter.unusedVariables false)
macro (docComment)? "DefinitionDoc" ident "as" str (" in " str)? (str)? : command =>
  `(command| set_option linter.unusedVariables false)

macro "NewTactic" ident* : command => `(command| set_option linter.unusedVariables false)
macro "NewTheorem" ident* : command => `(command| set_option linter.unusedVariables false)
macro "NewLemma" ident* : command => `(command| set_option linter.unusedVariables false)
macro "NewDefinition" ident* : command => `(command| set_option linter.unusedVariables false)
macro "OnlyTactic" ident* : command => `(command| set_option linter.unusedVariables false)
macro "OnlyTheorem" ident* : command => `(command| set_option linter.unusedVariables false)
macro "OnlyLemma" ident* : command => `(command| set_option linter.unusedVariables false)
macro "OnlyDefinition" ident* : command => `(command| set_option linter.unusedVariables false)
macro "DisabledTactic" ident* : command => `(command| set_option linter.unusedVariables false)
macro "DisabledTheorem" ident* : command => `(command| set_option linter.unusedVariables false)
macro "DisabledLemma" ident* : command => `(command| set_option linter.unusedVariables false)
macro "DisabledDefinition" ident* : command => `(command| set_option linter.unusedVariables false)
macro "HiddenTactic" ident* : command => `(command| set_option linter.unusedVariables false)
macro "HiddenTheorem" ident* : command => `(command| set_option linter.unusedVariables false)
macro "HiddenLemma" ident* : command => `(command| set_option linter.unusedVariables false)
macro "HiddenDefinition" ident* : command => `(command| set_option linter.unusedVariables false)

macro "VisualSkipLevel" : command => `(command| set_option linter.unusedVariables false)
macro "VisualLevelNumber" str : command => `(command| set_option linter.unusedVariables false)
macro "VisualColorScheme" ident : command => `(command| set_option linter.unusedVariables false)
macro "VisualDramaticStart" : command => `(command| set_option linter.unusedVariables false)
macro "VisualEmphasize" ident : command => `(command| set_option linter.unusedVariables false)
macro "VisualUnlockTactic" ident* : command => `(command| set_option linter.unusedVariables false)
macro "VisualGoalInfo" ident visualBool str : command => `(command| set_option linter.unusedVariables false)
macro "VisualGoalInfoOnGoal" ident "true" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualGoalInfoOnGoal" ident "false" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualGoalInfoOnGoalWithHyp" ident visualBool str str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualGoalInfoOnGoalWithoutHyp" ident visualBool str str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformSideInfo" ident str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformSideInfoOnGoal" ident str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformRewriteInfo" ident str str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformRewriteInfoOnGoal" ident str str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformBackInfoOnGoal" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformReverseInfoOnGoal" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTransformInfoOnGoal" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTacticHypInfo" ident ident str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualTacticHypInfoOnGoal" ident ident str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualHypGoalInfo" ident str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualHypGoalInfoOnGoal" ident str "show" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualProofGraphInfo" str : command =>
  `(command| set_option linter.unusedVariables false)
macro "VisualProofGraphInfoOnGoal" str "show" str : command =>
  `(command| set_option linter.unusedVariables false)

syntax (name := browserStatement) "Statement" declSig declVal : command

macro_rules
  | `(Statement $sig:declSig := by $proof:tacticSeq) =>
      `(command| private theorem browser_statement $sig:declSig := by $proof:tacticSeq)

macro "MakeGame" : command => `(command| set_option linter.unusedVariables false)

end GameServer
