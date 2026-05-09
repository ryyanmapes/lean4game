import GameServer.Helpers
import GameServer.Inventory
import GameServer.Options
import GameServer.SaveData
import GameServer.Hints
import GameServer.Tactic.LetIntros
import GameServer.Tactic.Template
import GameServer.RpcHandlers -- only needed to collect the translations of "level completed" msgs
import I18n

open Lean Meta Elab Command Std

namespace GameServer

set_option autoImplicit false

def getTheoremKind (name : Name) : CommandElabM TheoremKind := do
  runTermElabM fun _ => do
    let constExpr ← mkConstWithFreshMVarLevels name
    let constType ← inferType constExpr
    let (args, _, body) ← forallMetaTelescopeReducing constType
    let mut hasPropBinder := false
    for arg in args do
      let argType ← instantiateMVars (← inferType arg)
      if ← isProp argType then
        hasPropBinder := true
    if let some (_, lhs, rhs) ← matchEq? body then
      -- A theorem whose body is `a = a` (lhs and rhs syntactically equal)
      -- is reflexivity-like and not useful as a rewrite rule; surface it in
      -- the proposition menu instead.
      if lhs == rhs then
        pure .proposition
      else if hasPropBinder then
        -- Equalities that still require proposition premises are more useful as
        -- combining-mode theorems so the user can discharge the premises first.
        pure .proposition
      else
        pure .equality
    else
      pure .proposition

/-! # Game metadata -/

/-- Switch to the specified `Game` (and create it if non-existent). Example: `Game "NNG"` -/
elab "Game" n:str : command => do
  let name := n.getString
  setCurGameId name
  if (← getGame? name).isNone then
    insertGame name {name}

/-- Create a new world in the active game. Example: `World "Addition"` -/
elab "World" n:str : command => do
  let name := n.getString
  setCurWorldId name
  if ¬ (← getCurGame).worlds.nodes.contains name then
    addWorld {name}

/-- Define the current level number. Levels inside a world must be
numbered consecutive starting with `1`. Example: `Level 1` -/
elab "Level" level:num : command => do
  let level := level.getNat
  setCurLevelIdx level
  addLevel {index := level}

/-- Define the title of the current game/world/level. -/
elab "Title" t:str : command => do
  let title ← t.getString.translate
  match ← getCurLayer with
  | .Level => modifyCurLevel fun level => pure {level with title := title}
  | .World => modifyCurWorld  fun world => pure {world with title := title}
  | .Game => modifyCurGame  fun game => pure {game with
      title := title
      tile := {game.tile with title := title}}

/-- Define the introduction of the current game/world/level. -/
elab "Introduction" t:str : command => do
  let intro ← t.getString.translate
  match ← getCurLayer with
  | .Level => modifyCurLevel fun level => pure {level with introduction := intro}
  | .World => modifyCurWorld  fun world => pure {world with introduction := intro}
  | .Game => modifyCurGame  fun game => pure {game with introduction := intro}

/-- Define the info of the current game. Used for e.g. credits -/
elab "Info" t:str : command => do
  let info ← t.getString.translate
  match ← getCurLayer with
  | .Level =>
    logError "Can't use `Info` in a level!"
    pure ()
  | .World =>
    logError "Can't use `Info` in a world"
    pure ()
  | .Game => modifyCurGame  fun game => pure {game with info := info}

/-- Provide the location of the image for the current game/world/level.
Paths are relative to the lean project's root. -/
elab "Image" t:str : command => do
  let file := t.getString
  if not <| ← System.FilePath.pathExists file then
    logWarningAt t s!"Make sure the cover image '{file}' exists."
  if not <| file.startsWith "images/" then
    logWarningAt t s!"The file name should start with `images/`. Make sure all images are in that folder."

  match ← getCurLayer with
  | .Level =>
    logWarning "Level-images not implemented yet" -- TODO
    modifyCurLevel fun level => pure {level with image := file}
  | .World =>
    modifyCurWorld  fun world => pure {world with image := file}
  | .Game =>
    logWarning "Main image of the game not implemented yet" -- TODO
    modifyCurGame  fun game => pure {game with image := file}

/-- Define the conclusion of the current game or current level if some
building a level. -/
elab "Conclusion" t:str : command => do
  let conclusion ← t.getString.translate
  match ← getCurLayer with
  | .Level => modifyCurLevel fun level => pure {level with conclusion := conclusion}
  | .World => modifyCurWorld  fun world => pure {world with conclusion := conclusion}
  | .Game => modifyCurGame  fun game => pure {game with conclusion := conclusion}

/-- A list of games that should be played before this one. Example `Prerequisites "NNG" "STG"`. -/
elab "Prerequisites" t:str* : command => do
  modifyCurGame fun game => pure {game with
    tile := {game.tile with prerequisites := t.map (·.getString) |>.toList}}

/-- Short caption for the game (1 sentence) -/
elab "CaptionShort" t:str : command => do
  let caption ← t.getString.translate
  modifyCurGame fun game => pure {game with
    tile := {game.tile with short := caption}}

/-- More detailed description what the game is about (2-4 sentences). -/
elab "CaptionLong" t:str : command => do
  let caption ← t.getString.translate
  modifyCurGame fun game => pure {game with
    tile := {game.tile with long := caption}}

/-- A list of Languages the game is translated to. For example `Languages "de" "en"`.

The keys are ISO language codes.
 -/
elab "Languages" t:str* : command => do
  modifyCurGame fun game => pure {game with
    tile := {game.tile with languages := t.map (·.getString) |>.toList}}

/-- The Image of the game (optional). TODO: Not implemented -/
elab "CoverImage" t:str : command => do
  let file := t.getString
  if not <| ← System.FilePath.pathExists file then
    logWarningAt t s!"Make sure the cover image '{file}' exists."
  if not <| file.startsWith "images/" then
    logWarningAt t s!"The file name should start with `images/`. Make sure all images are in that folder."

  modifyCurGame fun game => pure {game with
    tile := {game.tile with image := file}}

/-- Hide this level from the Visual Lean interface. Navigation buttons and the world map
skip it; players can still reach it by entering the URL directly. -/
elab "VisualSkipLevel" : command => do
  modifyCurLevel fun lvl => pure { lvl with visualSkipLevel := true }

/-- Override the Visual Lean map label for special levels, e.g. `VisualLevelNumber "Boss"`. -/
elab "VisualLevelNumber" label:str : command => do
  modifyCurLevel fun lvl => pure { lvl with visualLevelNumber? := some label.getString }

/-- Attach a named Visual Lean color scheme to the current level. -/
elab "VisualColorScheme" color:ident : command => do
  modifyCurLevel fun lvl => pure { lvl with visualColorScheme? := some color.getId.toString }

/-- Mark the current level as having a dramatic Visual Lean opening. -/
elab "VisualDramaticStart" : command => do
  modifyCurLevel fun lvl => pure { lvl with visualDramaticStart := true }

/-- Highlight a tactic or theorem in the Visual Lean inventory tray with a soft glow.
Can be used multiple times to highlight multiple items. Example: `VisualEmphasize exact` -/
elab "VisualEmphasize" name:ident : command => do
  modifyCurLevel fun lvl => pure { lvl with visualEmphasize := lvl.visualEmphasize.push name.getId }

/-- Unlock tactics only in the Visual Lean tactic tray, starting in this level and
continuing through later levels that depend on it. -/
elab "VisualUnlockTactic" args:ident* : command => do
  modifyCurLevel fun lvl => pure {
    lvl with visualTacticUnlocks := lvl.visualTacticUnlocks ++ args.map (·.getId)
  }

syntax visualBool := &"true" <|> &"false"

def mkVisualGoalInfo (position : String) (arrow : Bool) (goal : Option String) (text : String)
    (requireHypType : Option String := none) (excludeHypType : Option String := none) :
    VisualGoalInfo :=
  { position := position, arrow := arrow, goal := goal,
    requireHypType := requireHypType, excludeHypType := excludeHypType, text := text }

def mkVisualTransformSideInfo (side : String) (goal : Option String) (text : String) :
    VisualTransformInfo :=
  { kind := "side", side := some side, goal := goal, text := text }

def mkVisualTransformRewriteInfo (source target : String) (goal : Option String) (text : String) :
    VisualTransformInfo :=
  { kind := "rewrite", source := source, target := target, goal := goal, text := text }

def mkVisualTransformBackInfo (goal : Option String) (text : String) :
    VisualTransformInfo :=
  { kind := "back", goal := goal, text := text }

def mkVisualTransformReverseInfo (goal : Option String) (text : String) :
    VisualTransformInfo :=
  { kind := "reverse", goal := goal, text := text }

def mkVisualTransformGeneralInfo (goal : Option String) (text : String) :
    VisualTransformInfo :=
  { kind := "info", goal := goal, text := text }

def mkVisualTacticHypInfo (tactic hyp : String) (goal : Option String) (text : String) :
    VisualTacticHypInfo :=
  { tactic := tactic, hyp := hyp, goal := goal, text := text }

def mkVisualHypGoalInfo (hyp : String) (goal : Option String) (text : String) :
    VisualHypGoalInfo :=
  { hyp := hyp, goal := goal, text := text }

def mkVisualProofGraphInfo (goal : Option String) (text : String) :
    VisualProofGraphInfo :=
  { goal := goal, text := text }

/-- Add Visual Lean-only instructional text near the goal card.
Usage: `VisualGoalInfo below true "message"` or `VisualGoalInfo above false "message"`. -/
elab "VisualGoalInfo " pos:ident arrow:visualBool text:str : command => do
  let position := pos.getId.toString
  unless position == "above" || position == "below" do
    throwErrorAt pos "VisualGoalInfo position must be `above` or `below`"
  let arrowBool :=
    match arrow with
    | `(visualBool| true) => true
    | `(visualBool| false) => false
    | _ => false
  let info := mkVisualGoalInfo position arrowBool none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualGoalInfos := lvl.visualGoalInfos.push info }

/-- Add Visual Lean-only instructional text near the goal card, only while the current
goal matches the supplied display text. -/
elab "VisualGoalInfoOnGoal " pos:ident &"true" goalText:str &"show" text:str : command => do
  let position := pos.getId.toString
  unless position == "above" || position == "below" do
    throwErrorAt pos "VisualGoalInfoOnGoal position must be `above` or `below`"
  let info := mkVisualGoalInfo position true (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualGoalInfos := lvl.visualGoalInfos.push info }

/-- Add Visual Lean-only instructional text near the goal card, only while the current
goal matches the supplied display text. -/
elab "VisualGoalInfoOnGoal " pos:ident &"false" goalText:str &"show" text:str : command => do
  let position := pos.getId.toString
  unless position == "above" || position == "below" do
    throwErrorAt pos "VisualGoalInfoOnGoal position must be `above` or `below`"
  let info := mkVisualGoalInfo position false (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualGoalInfos := lvl.visualGoalInfos.push info }

/-- Add Visual Lean-only instructional text near the goal card, only while the current
goal matches the supplied display text AND a hypothesis with the given type is present.
Use this to gate a message on the user having produced a particular intermediate hypothesis. -/
elab "VisualGoalInfoOnGoalWithHyp " pos:ident arrow:visualBool goalText:str hypType:str
    &"show" text:str : command => do
  let position := pos.getId.toString
  unless position == "above" || position == "below" do
    throwErrorAt pos "VisualGoalInfoOnGoalWithHyp position must be `above` or `below`"
  let arrowBool :=
    match arrow with
    | `(visualBool| true) => true
    | `(visualBool| false) => false
    | _ => false
  let info := mkVisualGoalInfo position arrowBool (some (goalText.getString)) text.getString
    (requireHypType := some (hypType.getString))
  modifyCurLevel fun lvl => pure { lvl with visualGoalInfos := lvl.visualGoalInfos.push info }

/-- Add Visual Lean-only instructional text near the goal card, only while the current
goal matches the supplied display text AND no hypothesis with the given type is present.
Use this to gate a message on the user *not yet* having produced a particular hypothesis. -/
elab "VisualGoalInfoOnGoalWithoutHyp " pos:ident arrow:visualBool goalText:str hypType:str
    &"show" text:str : command => do
  let position := pos.getId.toString
  unless position == "above" || position == "below" do
    throwErrorAt pos "VisualGoalInfoOnGoalWithoutHyp position must be `above` or `below`"
  let arrowBool :=
    match arrow with
    | `(visualBool| true) => true
    | `(visualBool| false) => false
    | _ => false
  let info := mkVisualGoalInfo position arrowBool (some (goalText.getString)) text.getString
    (excludeHypType := some (hypType.getString))
  modifyCurLevel fun lvl => pure { lvl with visualGoalInfos := lvl.visualGoalInfos.push info }

/-- Add Visual Lean-only transformation guidance for switching equation sides.
Usage: `VisualTransformSideInfo left "message"` or `VisualTransformSideInfo right "message"`. -/
elab "VisualTransformSideInfo " side:ident text:str : command => do
  let sideStr := side.getId.toString
  unless sideStr == "left" || sideStr == "right" do
    throwErrorAt side "VisualTransformSideInfo side must be `left` or `right`"
  let info := mkVisualTransformSideInfo sideStr none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only transformation guidance for switching equation sides, only
while the current goal matches the supplied display text. -/
elab "VisualTransformSideInfoOnGoal " side:ident goalText:str &"show" text:str : command => do
  let sideStr := side.getId.toString
  unless sideStr == "left" || sideStr == "right" do
    throwErrorAt side "VisualTransformSideInfoOnGoal side must be `left` or `right`"
  let info := mkVisualTransformSideInfo sideStr (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only transformation guidance linking a rule card to a subexpression.
Usage: `VisualTransformRewriteInfo h "y" "message"`. -/
elab "VisualTransformRewriteInfo " source:ident target:str text:str : command => do
  let info := mkVisualTransformRewriteInfo source.getId.toString target.getString none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only transformation guidance linking a rule card to a subexpression,
only while the current goal matches the supplied display text. -/
elab "VisualTransformRewriteInfoOnGoal " source:ident target:str goalText:str &"show" text:str : command => do
  let info := mkVisualTransformRewriteInfo source.getId.toString target.getString (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only transformation guidance pointing to the Back button, only
while the current goal matches the supplied display text. -/
elab "VisualTransformBackInfoOnGoal " goalText:str &"show" text:str : command => do
  let info := mkVisualTransformBackInfo (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only transformation guidance pointing to the rewrite-direction
button, only while the current goal matches the supplied display text. -/
elab "VisualTransformReverseInfoOnGoal " goalText:str &"show" text:str : command => do
  let info := mkVisualTransformReverseInfo (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only instructional text inside the transformation overlay
*without* drawing an arrow to any UI control. Use this for general status text
(e.g. "you must make both sides match") that doesn't direct the player to a
specific button. Shown only while the current goal matches the supplied text. -/
elab "VisualTransformInfoOnGoal " goalText:str &"show" text:str : command => do
  let info := mkVisualTransformGeneralInfo (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTransformInfos := lvl.visualTransformInfos.push info }

/-- Add Visual Lean-only guidance linking a tactic card to a hypothesis card.
Usage: `VisualTacticHypInfo induction n "message"`. -/
elab "VisualTacticHypInfo " tactic:ident hyp:ident text:str : command => do
  let info := mkVisualTacticHypInfo tactic.getId.toString hyp.getId.toString none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTacticHypInfos := lvl.visualTacticHypInfos.push info }

/-- Add Visual Lean-only guidance linking a tactic card to a hypothesis card, only
while the current goal matches the supplied display text. -/
elab "VisualTacticHypInfoOnGoal " tactic:ident hyp:ident goalText:str &"show" text:str : command => do
  let info := mkVisualTacticHypInfo tactic.getId.toString hyp.getId.toString (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualTacticHypInfos := lvl.visualTacticHypInfos.push info }

/-- Add Visual Lean-only guidance linking a hypothesis card to the goal card.
Usage: `VisualHypGoalInfo h "message"`. -/
elab "VisualHypGoalInfo " hyp:ident text:str : command => do
  let info := mkVisualHypGoalInfo hyp.getId.toString none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualHypGoalInfos := lvl.visualHypGoalInfos.push info }

/-- Add Visual Lean-only guidance linking a hypothesis card to the goal card, only
while the current goal matches the supplied display text. -/
elab "VisualHypGoalInfoOnGoal " hyp:ident goalText:str &"show" text:str : command => do
  let info := mkVisualHypGoalInfo hyp.getId.toString (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualHypGoalInfos := lvl.visualHypGoalInfos.push info }

/-- Add Visual Lean-only instructional text to the left of the proof-stream graph.
Usage: `VisualProofGraphInfo "message"`. -/
elab "VisualProofGraphInfo " text:str : command => do
  let info := mkVisualProofGraphInfo none text.getString
  modifyCurLevel fun lvl => pure { lvl with visualProofGraphInfos := lvl.visualProofGraphInfos.push info }

/-- Add Visual Lean-only instructional text to the left of the proof-stream graph,
only while the current goal matches the supplied display text. -/
elab "VisualProofGraphInfoOnGoal " goalText:str &"show" text:str : command => do
  let info := mkVisualProofGraphInfo (some (goalText.getString)) text.getString
  modifyCurLevel fun lvl => pure { lvl with visualProofGraphInfos := lvl.visualProofGraphInfos.push info }

-- Note: the syntax to add multiple is `(&"anotherOption" <|> &"unbundleHyps")`
syntax settingsArg := atomic(" (" (&"unbundleHyps") " := " withoutPosition(term) ")")

/--
Settings to customise the game appearance. Usage `Settings (setting1 := val1) (setting2 := val2)`.
Valid settings are:

* (unbundleHyps := false)
 -/
elab "Settings " args:settingsArg* : command => do
  let mut settings: Game.Settings := default
  for arg in args do
    match arg with
    | `(settingsArg| (unbundleHyps := true)) => settings := { settings with unbundleHyps := true }
    | `(settingsArg| (unbundleHyps := false)) => settings := { unbundleHyps := false }
    | _ => throwUnsupportedSyntax
  modifyCurGame (pure { · with settings := settings })

/-! # Inventory

The inventory contains docs for tactics, theorems, and definitions. These are all locked
in the first level and get enabled during the game.
-/

/-! ## Doc entries -/

/-- Documentation entry of a tactic. Example:

```
/-- `rw` stands for rewrite, etc. -/
TacticDoc rw

/-- `rw` stands for rewrite, etc. -/
TacticDoc rw in "Equalities"
```

* The identifier is the tactics name. Some need to be escaped like `«have»`.
* The description is a string supporting Markdown.
 -/
elab doc:docComment ? "TacticDoc" name:ident inArg?:((" in " str)?) content:str ? : command => do
  let doc ← parseDocCommentLegacy doc content
  let doc ← doc.translate
  let cat : String := if !inArg?.raw.isNone then (⟨inArg?.raw[1]⟩ : TSyntax `str).getString else "📖︎"
  modifyEnv (inventoryTemplateExt.addEntry · {
    type := .Tactic
    name := name.getId
    displayName := name.getId.toString
    category := cat
    content := doc })

/-- Documentation entry of a theorem. Example:

```
/-- says `0 < n.succ`, etc. -/
TheoremDoc Nat.succ_pos as "succ_pos"

/-- says `0 < n.succ`, etc. -/
TheoremDoc Nat.succ_pos as "succ_pos" in "Nat"
```

* The first identifier is used in the commands `[New/Only/Disabled]Theorem`.
  It is preferably the true name of the theorem. However, this is not required.
* The string following `as` is the displayed name (in the Inventory).
* The identifier after `in` is the category to group theorems by (in the Inventory).
* The description is a string supporting Markdown.

Use `[[mathlib_doc]]` in the string to insert a link to the mathlib doc page. This requires
The theorem/definition to have the same fully qualified name as in mathlib.
 -/
elab doc:docComment ? "TheoremDoc" name:ident "as" displayName:str inArg?:((" in " str)?) content:str ? :
    command => do
  let doc ← parseDocCommentLegacy doc content
  let doc ← doc.translate
  let cat : String := if !inArg?.raw.isNone then (⟨inArg?.raw[1]⟩ : TSyntax `str).getString else "📖︎"
  modifyEnv (inventoryTemplateExt.addEntry · {
    type := .Theorem
    name := name.getId
    category := cat
    displayName := displayName.getString
    content := doc })
-- TODO: Catch the following behaviour.
-- 1. if `TheoremDoc` appears in the same file as `Statement`, it will silently use
-- it but display the info that it wasn't found in `Statement`
-- 2. if it appears in a later file, however, it will silently not do anything and keep
-- the first one.


/-- Documentation entry of a definition. Example:

```
/-- defined as `Injective f ∧ Surjective`, etc. -/
DefinitionDoc Function.Bijective as "Bijective"

/-- defined as `Injective f ∧ Surjective`, etc. -/
DefinitionDoc Function.Bijective as "Bijective" in "Fun"
```

* The first identifier is used in the commands `[New/Only/Disabled]Definition`.
  It is preferably the true name of the definition. However, this is not required.
* The string following `as` is the displayed name (in the Inventory).
* The description is a string supporting Markdown.

Use `[[mathlib_doc]]` in the string to insert a link to the mathlib doc page. This requires
The theorem/definition to have the same fully qualified name as in mathlib.
 -/
elab doc:docComment ? "DefinitionDoc" name:ident "as" displayName:str inArg?:((" in " str)?) template:str ? : command => do
  let doc ← parseDocCommentLegacy doc template
  let doc ← doc.translate
  let cat : String := if !inArg?.raw.isNone then (⟨inArg?.raw[1]⟩ : TSyntax `str).getString else "📖︎"
  modifyEnv (inventoryTemplateExt.addEntry · {
    type := .Definition
    name := name.getId
    displayName := displayName.getString
    category := cat
    content := doc })

/-! ## Add inventory items -/

def checkCommandNotDuplicated (items : Array Name) (cmd := "Command") : CommandElabM Unit := do
  if ¬ items.isEmpty then
    logWarning s!"You should only use one `{cmd}` per level, but it takes multiple arguments: `{cmd} obj₁ obj₂ obj₃`!"

/-- Declare tactics that are introduced by this level. -/
elab "NewTactic" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).tactics.new) "NewTactic"
  for name in args do
    checkInventoryDoc .Tactic name -- TODO: Add (template := "[docstring]")
  modifyCurLevel fun level => pure {level with
    tactics := {level.tactics with new := level.tactics.new ++ args.map (·.getId)}}

/-- Declare tactics that are introduced by this level but do not show up in inventory. -/
elab "NewHiddenTactic" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).tactics.hidden) "NewHiddenTactic"
  for name in args do
    checkInventoryDoc .Tactic name (template := "")
  modifyCurLevel fun level => pure {level with
    tactics := {level.tactics with new := level.tactics.new ++ args.map (·.getId),
                                   hidden := level.tactics.hidden ++ args.map (·.getId)}}

/-- Declare theorems that are introduced by this level. -/
elab "NewTheorem" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).lemmas.new) "NewTheorem"
  for name in args do
    try let _decl ← getConstInfo name.getId catch
      | _ => logErrorAt name m!"unknown identifier '{name}'."
    checkInventoryDoc .Theorem name -- TODO: Add (template := "[mathlib]")
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with new := args.map (·.getId)}}

/-- Declare definitions that are introduced by this level. -/
elab "NewDefinition" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).definitions.new) "NewDefinition"
  for name in args do checkInventoryDoc .Definition name -- TODO: Add (template := "[mathlib]")
  modifyCurLevel fun level => pure {level with
    definitions := {level.definitions with new := args.map (·.getId)}}

/-- Declare tactics that are temporarily disabled in this level.
This is ignored if `OnlyTactic` is set. -/
elab "DisabledTactic" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).tactics.disabled) "DisabledTactic"
  for name in args do checkInventoryDoc .Tactic name
  modifyCurLevel fun level => pure {level with
    tactics := {level.tactics with disabled := args.map (·.getId)}}

/-- Declare theorems that are temporarily disabled in this level.
This is ignored if `OnlyTheorem` is set. -/
elab "DisabledTheorem" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).lemmas.disabled) "DisabledTheorem"
  for name in args do checkInventoryDoc .Theorem name
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with disabled := args.map (·.getId)}}

/-- Declare definitions that are temporarily disabled in this level -/
elab "DisabledDefinition" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).definitions.disabled) "DisabledDefinition"
  for name in args do checkInventoryDoc .Definition name
  modifyCurLevel fun level => pure {level with
    definitions := {level.definitions with disabled := args.map (·.getId)}}

/-- Temporarily disable all tactics except the ones declared here -/
elab "OnlyTactic" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).tactics.only) "OnlyTactic"
  for name in args do checkInventoryDoc .Tactic name
  modifyCurLevel fun level => pure {level with
    tactics := {level.tactics with only := args.map (·.getId)}}

/-- Temporarily disable all theorems except the ones declared here -/
elab "OnlyTheorem" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).lemmas.only) "OnlyTheorem"
  for name in args do checkInventoryDoc .Theorem name
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with only := args.map (·.getId)}}

/-- Temporarily disable all definitions except the ones declared here.
This is ignored if `OnlyDefinition` is set. -/
elab "OnlyDefinition" args:ident* : command => do
  checkCommandNotDuplicated ((←getCurLevel).definitions.only) "OnlyDefinition"
  for name in args do checkInventoryDoc .Definition name
  modifyCurLevel fun level => pure {level with
    definitions := {level.definitions with only := args.map (·.getId)}}

/-- Define which tab of Lemmas is opened by default. Usage: `TheoremTab "Nat"`.
If omitted, the current tab will remain open. -/
elab "TheoremTab"  category:str : command =>
  modifyCurLevel fun level => pure {level with lemmaTab := category.getString}


/-! DEPRECATED -/

elab doc:docComment ? "LemmaDoc" name:ident "as" displayName:str "in" category:str content:str ? :
    command => do
  logWarning "Deprecated. Has been renamed to `TheoremDoc`"
  let doc ← parseDocCommentLegacy doc content
  modifyEnv (inventoryTemplateExt.addEntry · {
    type := .Theorem
    name := name.getId
    category := category.getString
    displayName := displayName.getString
    content := doc })

elab "NewLemma" args:ident* : command => do
  logWarning "Deprecated. Has been renamed to `NewTheorem`"
  checkCommandNotDuplicated ((←getCurLevel).lemmas.new) "NewLemma"
  for name in args do
    try let _decl ← getConstInfo name.getId catch
      | _ => logErrorAt name m!"unknown identifier '{name}'."
    checkInventoryDoc .Theorem name -- TODO: Add (template := "[mathlib]")
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with new := args.map (·.getId)}}

elab "DisabledLemma" args:ident* : command => do
  logWarning "Deprecated. Has been renamed to `DisabledTheorem`"
  checkCommandNotDuplicated ((←getCurLevel).lemmas.disabled) "DisabledLemma"
  for name in args  do checkInventoryDoc .Theorem name
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with disabled := args.map (·.getId)}}

elab "OnlyLemma" args:ident* : command => do
  logWarning "Deprecated. Has been renamed to `OnlyTheorem`"
  checkCommandNotDuplicated ((←getCurLevel).lemmas.only) "OnlyLemma"
  for name in args do checkInventoryDoc .Theorem name
  modifyCurLevel fun level => pure {level with
    lemmas := {level.lemmas with only := args.map (·.getId)}}

elab "LemmaTab"  category:str : command => do
  logWarning "Deprecated. Has been renamed to `TheoremTab`"
  modifyCurLevel fun level => pure {level with lemmaTab := category.getString}

/-! # Exercise Statement -/

/-- You can write `Statement add_comm (preamble := simp) .... := by` which
will automatically execute the given tactic sequence before the exercise
is handed to the player.

A common example is to use

```
refine { carrier := M, ?.. }
```

in exercises, where the statement is a structure, to fill in all the data fields.

For example in "Show that all matrices with first column zero form a submodule",
you could provide the set of all these matrices as `carrier` and the player will receive
all the `Prop`-valued fields as goals.
-/
syntax preambleArg := atomic("(" &"preamble" ":=" withoutPosition(tacticSeq) ")")

/-- Define the statement of the current level. -/
elab doc:docComment ? attrs:Parser.Term.attributes ?
    "Statement" statementName:ident ? preamble:preambleArg ? sig:declSig val:declVal : command => do
  let lvlIdx ← getCurLevelIdx

  let optSig := declSig.toOptDeclSig sig
  let isProp ← declSig.isProp sig

  -- add an optional tactic sequence that the engine executes before the game starts
  let preambleSeq : TSyntax ``Lean.Parser.Tactic.tacticSeq ← match preamble with
  | none => `(Parser.Tactic.tacticSeq|skip)
  | some x => match x with
    | `(preambleArg| (preamble := $tac)) => pure tac
    | _ => `(Parser.Tactic.tacticSeq|skip)

  let docContent ← parseDocComment doc
  let docContent ← match docContent with
  | none => pure none
  | some d => d.translate

  -- The default name of the statement is `[Game].[World].level[no.]`, e.g. `NNG.Addition.level1`
  -- However, this should not be used when designing the game.
  let defaultDeclName : Ident := mkIdent <| (← getCurGame).name ++ (← getCurWorld).name ++
    ("level" ++ toString lvlIdx : String)

  -- Collect all used tactics/lemmas in the sample proof:
  let usedInventory ← match val with
  | `(Parser.Command.declVal| := $proof:term) => do
    collectUsedInventory proof
  | _ => throwError "expected `:=`"

  -- extract the `tacticSeq` from `val` in order to add `let_intros` in front.
  -- TODO: don't understand meta-programming enough to avoid having `let_intros`
  -- duplicated three times below…
  let tacticStx : TSyntax `Lean.Parser.Tactic.tacticSeq := match val with
  | `(Parser.Command.declVal| := by $proof) => proof
  | _ => panic "expected `:= by`"

  -- Add theorem to context.
  match statementName with
  | some name =>
    let env ← getEnv
    let fullName := (← getCurrNamespace) ++ name.getId
    let inventoryType : InventoryType := if isProp then .Theorem else .Definition
    if env.contains fullName then
      let some orig := env.constants.map₁.get? fullName
        | throwError s!"error in \"Statement\": `{fullName}` not found."
      let origType := orig.type
      -- TODO: Check if `origType` agrees with `sig` and output `logInfo` instead of `logWarning`
      -- in that case.
      logWarningAt name (m!"Environment already contains {fullName}! Only the existing " ++
      m!"statement will be available in later levels:\n\n{origType}")
      let thmStatement ← match isProp with
        | true => `(command| $[$doc]? $[$attrs:attributes]? theorem $defaultDeclName $sig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
        | false => `(command| $[$doc]? $[$attrs:attributes]? def $defaultDeclName $optSig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
      elabCommand thmStatement
      -- Check that statement has a docs entry.
      checkInventoryDoc inventoryType name (name := fullName) (template := docContent)
    else
      let thmStatement ← match isProp with
        | true => `(command| $[$doc]? $[$attrs:attributes]? theorem $name $sig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
        | false => `(command| $[$doc]? $[$attrs:attributes]? def $name $optSig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
      elabCommand thmStatement
      -- Check that statement has a docs entry.
      checkInventoryDoc inventoryType name (name := fullName) (template := docContent)
  | none =>
    let thmStatement ← match isProp with
      | true => `(command| $[$doc]? $[$attrs:attributes]? theorem $defaultDeclName $sig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
      | false => `(command| $[$doc]? $[$attrs:attributes]? def $defaultDeclName $optSig := by {let_intros; $(⟨preambleSeq⟩); $(⟨tacticStx⟩)})
    elabCommand thmStatement

  let scope ← getScope
  let env ← getEnv

  -- TODO: Is this desired or would it be better to get `elabCommand` above to ignore
  -- the namespace?
  let currNamespace ← getCurrNamespace

  -- Format theorem statement for displaying
  let sigString := sig.raw.reprint.getD ""
  let descrFormat : String := match statementName, isProp with
  | some name, true =>  s!"theorem {name.getId} {sigString} := by"
  | some name, false =>  s!"def {name.getId} {sigString} := by"
  | none, _ => s!"example {sigString} := by" -- TODO: is this correct?

  modifyCurLevel fun level => pure { level with
    module := env.header.mainModule
    goal := sig
    preamble := preambleSeq
    scope := scope
    descrText := docContent
    isProp := isProp
    statementName := match statementName with
    | none => default
    | some name => currNamespace ++ name.getId
    descrFormat := descrFormat
    tactics := {level.tactics with used := usedInventory.tactics.toArray}
    definitions := {level.definitions with used := usedInventory.definitions.toArray}
    lemmas := {level.lemmas with used := usedInventory.lemmas.toArray}
    }

-- TODO: Notes for testing if a declaration has the simp attribute

-- -- Test: From zulip
-- section test

-- open Lean Meta Elab Command Tactic Simp

-- def Lean.Meta.SimpTheorems.hasAttribute (d : SimpTheorems) (decl : Name) :=
--   d.isLemma (.decl decl) || d.isDeclToUnfold decl

-- def isInSimpset (simpAttr decl: Name) : CoreM Bool := do
--   let .some simpDecl ←getSimpExtension? simpAttr | return false
--   return (← simpDecl.getTheorems).hasAttribute decl

-- end test

/-! # Make Game -/

/-- The worlds of a game are joint by dependencies. These are
automatically computed but can also be defined with the syntax
`Dependency World₁ → World₂ → World₃`. -/
def Parser.dependency := Parser.sepBy1Indent Parser.ident "→"

/-- Manually add a dependency between two worlds.

Normally, the dependencies are computed automatically by the
tactics & lemmas used in the example
proof and the ones introduced by `NewLemma`/`NewTactic`.
Use the command `Dependency World₁ → World₂` to add a manual edge to the graph,
for example if the only dependency between the worlds is given by
the narrative. -/
elab "Dependency" s:Parser.dependency : command => do
  let mut source? : Option Name := none
  for stx in s.raw.getArgs.getEvenElems do
    let some source := source?
      | do
          source? := some stx.getId
          match (← getCurGame).worlds.nodes.get? stx.getId with
          | some _ => pure ()
          | none => logErrorAt stx m!"World `{stx.getId}` seems not to exist"
          continue
    let target := stx.getId
    match (← getCurGame).worlds.nodes.get? target with
    | some _ => pure ()
    | none => logErrorAt stx m!"World `{target}` seems not to exist"

    modifyCurGame fun game =>
      pure {game with worlds := {game.worlds with edges := game.worlds.edges.push (source, target)}}
    source? := some target

/-- Build the game. This command will precompute various things about the game, such as which
tactics are available in each level etc. -/
elab "MakeGame" : command => do
  let game ← getCurGame

  let env ← getEnv

  -- Now create The doc entries from the templates
  for item in inventoryTemplateExt.getState env do
    let name := item.name

    let content : String ← match item.content with
    | "" =>
      -- If documentation is missing, try using the docstring instead.
      let docstring ← getDocstring env name item.type
      match docstring with
      | some ds => pure s!"*(lean docstring)*\\\n{ds}"
      | none => pure "(missing)"
    | template =>
      -- TODO: Process content template.
      -- TODO: Add information about inventory items
      pure $ template.replace "[[mathlib_doc]]"
        s!"[mathlib doc](https://leanprover-community.github.io/mathlib4_docs/find/?pattern={name}#doc)"

    match item.type with
    | .Theorem =>
      let theoremKind ← getTheoremKind name
      let entry : InventoryItem := { item with
        content := content
        -- Add the lemma statement to the doc
        statement := (← getStatementString name)
        theoremKind? := some theoremKind
      }
      modifyEnv (inventoryExt.addEntry · entry)
    | _ =>
      modifyEnv (inventoryExt.addEntry · { item with
        content := content
      })

  -- For each `worldId` this contains a set of items used in this world
  let mut usedItemsInWorld : HashMap Name (HashSet Name) := {}

  -- For each `worldId` this contains a set of items newly defined in this world
  let mut newItemsInWorld : HashMap Name (HashSet Name) := {}

  -- Items that should not be displayed in inventory
  let mut hiddenItems : HashSet Name := {}

  let allWorlds := game.worlds.nodes.toArray
  let nrWorlds := allWorlds.size
  let mut nrLevels := 0

  -- Calculate which "items" are used/new in which world
  for (worldId, world) in allWorlds do
    let mut usedItems : HashSet Name := {}
    let mut newItems : HashSet Name := {}
    for inventoryType in #[.Tactic, .Definition, .Theorem] do
      for (levelId, level) in world.levels.toArray do
        usedItems := usedItems.insertMany (level.getInventory inventoryType).used
        newItems := newItems.insertMany (level.getInventory inventoryType).new
        hiddenItems := hiddenItems.insertMany (level.getInventory inventoryType).hidden

        -- if the previous level was named, we need to add it as a new lemma
        if inventoryType == .Theorem then
          match levelId with
          | 0 => pure ()
          | 1 => pure () -- level ids start with 1, so we need to skip 1, too
          | i₀ + 1 =>
            let some idx := world.levels.get? (i₀) | throwError s!"Level {i₀ + 1} not found for world {worldId}!"
            match (idx).statementName with
            | .anonymous => pure ()
            | .num _ _ => panic "Did not expect to get a numerical statement name!"
            | .str pre s =>
              let name := Name.str pre s
              newItems := newItems.insert name

          if inventoryType == .Theorem then

      -- if the last level was named, we need to add it as a new lemma
      let i₀ := world.levels.size

        let some idx := world.levels.get? (i₀) | throwError s!"Level {i₀} not found for world {worldId}!"
        match (idx).statementName with
        | .anonymous => pure ()
        | .num _ _ => panic "Did not expect to get a numerical statement name!"
        | .str pre s =>
          let name := Name.str pre s
          newItems := newItems.insert name

    usedItemsInWorld := usedItemsInWorld.insert worldId usedItems
    newItemsInWorld := newItemsInWorld.insert worldId newItems
    -- DEBUG: print new/used items
    -- logInfo m!"{worldId} uses: {usedItems.toList}"
    -- logInfo m!"{worldId} introduces: {newItems.toList}"

    -- Moreover, count the number of levels in the game
    nrLevels := nrLevels + world.levels.toArray.size

  /- for each "item" this is a HashSet of `worldId`s that introduce this item -/
  let mut worldsWithNewItem : HashMap Name (HashSet Name) := {}
  for (worldId, _world) in allWorlds do
    for newItem in newItemsInWorld.getD worldId {} do
      worldsWithNewItem := worldsWithNewItem.insert newItem $
        (worldsWithNewItem.getD newItem {}).insert worldId

  -- For each `worldId` this is a HashSet of `worldId`s that this world depends on.
  let mut worldDependsOnWorlds : HashMap Name (HashSet Name) := {}

  -- For a pair of `worldId`s `(id₁, id₂)` this is a HasSet of "items" why `id₁` depends on `id₂`.
  let mut dependencyReasons : HashMap (Name × Name) (HashSet Name) := {}

  -- Calculate world dependency graph `game.worlds`
  for (dependentWorldId, _dependentWorld) in allWorlds do
    let mut dependsOnWorlds : HashSet Name := {}
    -- Adding manual dependencies that were specified via the `Dependency` command.
    for (sourceId, targetId) in game.worlds.edges do
      if targetId = dependentWorldId then
        dependsOnWorlds := dependsOnWorlds.insert sourceId

    for usedItem in usedItemsInWorld.getD dependentWorldId {} do
      match worldsWithNewItem.get? usedItem with
      | none => logWarning m!"No world introducing {usedItem}, but required by {dependentWorldId}"
      | some worldIds =>
        -- Only need a new dependency if the world does not introduce an item itself
        if !worldIds.contains dependentWorldId then
          -- Add all worlds as dependencies which introduce this item
          -- TODO: Could do something more clever here.
          dependsOnWorlds := dependsOnWorlds.insertMany worldIds
          -- Store the dependency reasons for debugging
          for worldId in worldIds do
            let tmp := (dependencyReasons.getD (dependentWorldId, worldId) {}).insert usedItem
            dependencyReasons := dependencyReasons.insert (dependentWorldId, worldId) tmp
    worldDependsOnWorlds := worldDependsOnWorlds.insert dependentWorldId dependsOnWorlds

  -- Debugging: show all dependency reasons if the option `lean4game.showDependencyReasons` is set
  if lean4game.showDependencyReasons.get (← getOptions) then
    for (world, dependencies) in worldDependsOnWorlds.toArray do
      if dependencies.isEmpty then
        logInfo m!"Dependencies of '{world}': none"
      else
        let mut msg := m!"Dependencies of '{world}':"
        for dep in dependencies do
          match dependencyReasons.get? (world, dep) with
          | none =>
            msg := msg ++ m!"\n· '{dep}': no reason found (manually added?)"
          | some items =>
            msg := msg ++ m!"\n· '{dep}' because of:\n  {items.toList}"
        logInfo msg

  -- Check graph for loops and remove transitive edges
  let loop := findLoops worldDependsOnWorlds
  if loop != [] then
    logError m!"Loop: Dependency graph has a loop: {loop}"
    for i in [:loop.length] do
      let w1 := loop[i]!
      let w2 := loop[if i == loop.length - 1 then 0 else i + 1]!
      match dependencyReasons.get? (w1, w2) with
      -- This should not happen. Could use `find!` again...
      | none => logError m!"Did not find a reason why {w1} depends on {w2}."
      | some items =>
        logError m!"{w1} depends on {w2} because of {items.toList}."
  else
    worldDependsOnWorlds ← removeTransitive worldDependsOnWorlds

    -- need to delete all existing edges as they are already present in `worldDependsOnWorlds`.
    modifyCurGame fun game =>
      pure {game with worlds := {game.worlds with edges := Array.empty}}

    for (dependentWorldId, worldIds) in worldDependsOnWorlds.toArray do
      modifyCurGame fun game =>
        pure {game with worlds := {game.worlds with
          edges := game.worlds.edges.append (worldIds.toArray.map fun wid => (wid, dependentWorldId))}}

  -- Add the number of levels and worlds to the tile for the landing page
  modifyCurGame fun game => pure {game with tile := {game.tile with
    levels := nrLevels
    worlds := nrWorlds }}

  -- Apparently we need to reload `game` to get the changes to `game.worlds` we just made
  let game ← getCurGame

  let mut allItemsByType : HashMap InventoryType (HashSet Name) := {}
  -- Compute which inventory items are available in which level:
  for inventoryType in #[.Tactic, .Definition, .Theorem] do

    -- Which items are introduced in which world?
    let mut lemmaStatements : HashMap (Name × Nat) Name := {}
    -- TODO: I believe `newItemsInWorld` has way to many elements in it which we iterate over
    -- e.g. we iterate over `ring` for `Lemma`s as well, but so far that seems to cause no problems
    let mut allItems : HashSet Name := {}
    -- Map: item → (worldId, levelId, declIndex) recording where each item was introduced.
    -- Built inline here so no extra pass is needed. Used when unlocking predecessor items.
    let mut itemOrigin : HashMap Name (Name × Nat × Nat) := {}
    for (worldId, world) in game.worlds.nodes.toArray do
      let mut newItems : HashSet Name := {}
      for (levelId, level) in world.levels.toArray do
        let newLemmas := (level.getInventory inventoryType).new
        newItems := newItems.insertMany newLemmas
        allItems := allItems.insertMany newLemmas
        -- Record introduction origin for each new item, preserving declaration order.
        let mut declIdx := 0
        for item in newLemmas do
          itemOrigin := itemOrigin.insert item (worldId, levelId, declIdx)
          declIdx := declIdx + 1
        if inventoryType == .Theorem then
          -- For levels `2, 3, …` we check if the previous level was named
          -- in which case we add it as available lemma.
          match levelId with
          | 0 => pure ()
          | 1 => pure () -- level ids start with 1, so we need to skip 1, too.
          | i₀ + 1 =>
            -- add named statement from previous level to the available lemmas.
            let some idx := world.levels.get? (i₀) | throwError s!"Level {i₀ + 1} not found for world {worldId}!"
            match (idx).statementName with
            | .anonymous => pure ()
            | .num _ _ => panic "Did not expect to get a numerical statement name!"
            | .str pre s =>
              let name := Name.str pre s
              newItems := newItems.insert name
              allItems := allItems.insert name
              lemmaStatements := lemmaStatements.insert (worldId, levelId) name
              itemOrigin := itemOrigin.insert name (worldId, i₀, 0)
      if inventoryType == .Theorem then
        -- if named, add the lemma from the last level of the world to the inventory
        let i₀ := world.levels.size
        match i₀ with
        | 0 => logWarning m!"World `{worldId}` contains no levels."
        | i₀ =>
          let some idx := world.levels.get? (i₀) | throwError s!"Level {i₀} not found for world {worldId}!"
          match (idx).statementName with
          | .anonymous => pure ()
          | .num _ _ => panic "Did not expect to get a numerical statement name!"
          | .str pre s =>
            let name := Name.str pre s
            newItems := newItems.insert name
            allItems := allItems.insert name
            itemOrigin := itemOrigin.insert name (worldId, i₀, 0)
      newItemsInWorld := newItemsInWorld.insert worldId newItems

    -- Basic inventory item availability: all locked.
    let Availability₀ : HashMap Name InventoryTile :=
      HashMap.ofList $
        ← allItems.toList.mapM fun item => do
          -- Using a match statement because the error message of `Option.get!` is not helpful.
          match (← getInventoryItem? item inventoryType) with
          | none =>
            -- Note: we did have a panic here before because lemma statement and doc entry
            -- had mismatching namespaces
            logError m!"There is no inventory item ({inventoryType}) for: {item}."
            panic s!"Inventory item {item} not found!"
          | some data =>
            return (item, {
              name := item
              displayName := data.displayName
              category := data.category
              altTitle := data.statement
              hidden := hiddenItems.contains item })



    -- Availability after a given world
    let mut itemsInWorld : HashMap Name (HashMap Name InventoryTile) := {}
    for (worldId, _) in game.worlds.nodes.toArray do
      -- Unlock all items from previous worlds
      let mut items := Availability₀
      let predecessors := game.worlds.predecessors worldId
      -- logInfo m!"Predecessors: {predecessors.toArray.map fun (a) => (a)}"
      for predWorldId in predecessors do
        for item in newItemsInWorld.getD predWorldId {} do
          let data := (← getInventoryItem? item inventoryType).get!
          let (w, l, di) := itemOrigin.getD item (predWorldId, 0, 0)
          items := items.insert item {
            name := item
            displayName := data.displayName
            category := data.category
            world := w
            level := l
            declIndex := some di
            locked := false
            altTitle := data.statement
            hidden := hiddenItems.contains item }
      itemsInWorld := itemsInWorld.insert worldId items

    for (worldId, world) in game.worlds.nodes.toArray do
      let mut items := itemsInWorld.getD worldId {}

      let levels := world.levels.toArray.insertionSort fun a b => a.1 < b.1

      for (levelId, level) in levels do
        let levelInfo := level.getInventory inventoryType

        -- unlock items that are unlocked in this level
        let mut newItemIdx := 0
        for item in levelInfo.new do
          let data := (← getInventoryItem? item inventoryType).get!
          items := items.insert item {
            name := item
            displayName := data.displayName
            category := data.category
            world := worldId
            level := levelId
            declIndex := some newItemIdx
            locked := false
            altTitle := data.statement
            hidden := hiddenItems.contains item }
          newItemIdx := newItemIdx + 1

        -- add the exercise statement from the previous level
        -- if it was named
        if inventoryType == .Theorem then
          match lemmaStatements.get? (worldId, levelId) with
          | none => pure ()
          | some name =>
            let data := (← getInventoryItem? name inventoryType).get!
            items := items.insert name {
              name := name
              displayName := data.displayName
              category := data.category
              world := worldId
              -- from the previous level. This is fine b/c in practice levels start at 1
              level := (levelId - 1 : Nat)
              proven := true
              altTitle := data.statement
              locked := false }

        -- add marks for `disabled` and `new` lemmas here, so that they only apply to
        -- the current level.
        let itemsArray := items.toArray
          |>.insertionSort (fun a b => a.1.toString < b.1.toString)
          |>.map (·.2)
          |>.map (fun item => { item with
            disabled := if levelInfo.only.size == 0 then
                levelInfo.disabled.contains item.name
              else
                not (levelInfo.only.contains item.name)
            new := levelInfo.new.contains item.name
            })

        modifyLevel ⟨← getCurGameId, worldId, levelId⟩ fun level => do
          return level.setComputedInventory inventoryType itemsArray
    allItemsByType := allItemsByType.insert inventoryType allItems

  let game ← getCurGame
  for (worldId, world) in game.worlds.nodes.toArray do
    let mut unlockedVisualTactics : HashSet Name := {}
    for predWorldId in game.worlds.predecessors worldId do
      let some predWorld := game.worlds.nodes.get? predWorldId
        | throwError s!"World {predWorldId} does not exist"
      for (_, predLevel) in predWorld.levels.toArray do
        unlockedVisualTactics := unlockedVisualTactics.insertMany predLevel.visualTacticUnlocks

    let levels := world.levels.toArray.insertionSort fun a b => a.1 < b.1
    for (levelId, level) in levels do
      unlockedVisualTactics := unlockedVisualTactics.insertMany level.visualTacticUnlocks
      let visualTactics := unlockedVisualTactics.toArray.insertionSort
        (fun a b => a.toString < b.toString)
      modifyLevel ⟨← getCurGameId, worldId, levelId⟩ fun level => do
        pure { level with visualTactics := visualTactics }

  let getTiles (type : InventoryType) : CommandElabM (Array InventoryTile) := do
    (allItemsByType.getD type {}).toArray.mapM (fun name => do
      let some item ← getInventoryItem? name type
        | throwError "Expected item to exist: {name}"
      return item.toTile)
  let inventory : InventoryOverview := {
    lemmas := (← getTiles .Theorem).map (fun tile => {tile with hidden := hiddenItems.contains tile.name})
    tactics := (← getTiles .Tactic).map (fun tile => {tile with hidden := hiddenItems.contains tile.name})
    definitions := (← getTiles .Definition).map (fun tile => {tile with hidden := hiddenItems.contains tile.name})
    lemmaTab := none
  }

  saveGameData allItemsByType inventory
