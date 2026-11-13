import GameServer.AbstractCtx
import GameServer.Graph
import GameServer.Hints

namespace GameServer

open Std

-- TODO: Is there a better place?
/-- Keywords that the server should not consider as tactics.

Note: Added `clear` tactic because currently it is very useful in combination with
`Branch` and `Hint` (i.e. using `clear` before a `Hint` in order to remove any irrelevant
hypotheses).
-/
def GameServer.ALLOWED_KEYWORDS : List String :=
  ["with", "fun", "at", "only", "by", "generalizing", "using", "skip", "if", "then", "else", "clear"]

/-- The default game name if `Game "MyGame"` is not used. -/
def defaultGameName: String := "MyGame"
-- Note: When changing any of these default names, one also needs to change them in `index.mjs`

/-- The default game module name. -/
def defaultGameModule: String := "Game"

/-! # Environment extensions

The game framework stores almost all its game building data in environment extensions
defined in this file.
-/

open Lean

/-! ## Inventory (documentation)

The inventory contains documentation that the user can access.
There are three inventory types: Lemma, Tactic, Definition. They vary about in the information
they carry.

The commands `TheoremDoc`, `TacticDoc`, and `DefinitionDoc` add keys and templates to an
env. extension called `InventoryTemplateExt`. Commands like `NewLemma`, etc. as well as
`Statement` check if there is a key registered in this extension and might add a default or
print a warning if not.

Then, `MakeGame` takes the templates from `InventoryTemplateExt` and creates the documentation entries
that are sent to the client. This allows us to modify them like adding information from
mathlib or from parsing the lemma in question.
-/

/-- The game knows three different inventory types that contain slightly different information -/
inductive InventoryType where | Tactic | Theorem | Definition
deriving ToJson, FromJson, Repr, BEq, Hashable, Inhabited

-- TODO: golf this?
instance : ToString InventoryType := ⟨fun t => match t with
| .Tactic => "Tactic"
| .Theorem => "Theorem"
| .Definition => "Definition"⟩

/-- The keys/templates of the inventory items, stored in `InventoryTemplateExt`. -/
structure InventoryTemplate where
  /-- Lemma, Tactic, or Definition -/
  type: InventoryType
  /-- Depends on the type:
  * Tactic: the tactic's name
  * Lemma: fully qualified lemma name
  * Definition: no restrictions (preferably the definitions fully qualified name)
  -/
  name: Name
  /-- Only for Lemmas. To sort them into tabs -/
  category: String := default
  /-- Free-text short name -/
  displayName: String := name.toString
  /-- Template documentation. Allows for special tags to insert mathlib info [TODO!] -/
  content: String := ""
  deriving ToJson, Repr, Inhabited

/-- A full inventory item including the processing by `MakeGame`, which creates these
from the `InventoryTemplate`s and modifies them. -/
inductive TheoremKind where
| equality
| proposition
deriving ToJson, FromJson, Repr, Inhabited, BEq

structure InventoryItem extends InventoryTemplate where
  statement: String := ""
  theoremKind?: Option TheoremKind := none
  deriving ToJson, Repr, Inhabited

/-- A reduced variant of `InventoryItem` which is used for the tiles in the doc -/
structure InventoryTile where
  /--
  The name of the item. The restrictions are:

  * for Tactics: The name of the tactic.
  * for Lemmas: *Fully qualified* lemma name.
  * for Definitions: no restrictions.
  -/
  name : Name
  /-- The display name shown in the inventory. This can be free-text. -/
  displayName : String
  /-- Category to group inventory items by (currently only used for lemmas). -/
  category : String
  /-- The world which introduced this item. -/
  world : Option Name := none
  /-- The level which introduced this item. -/
  level : Option Nat := none
  /-- Declaration order within the introducing level (for stable tiebreaking). -/
  declIndex : Option Nat := none
  /-- Set to `true` if there exists an exercise in the game proving this statement. -/
  proven := false
  /-- If `true` then the item only gets unlocked in a later level. -/
  locked := true
  /-- If `true` then the item is blocked for this level. -/
  disabled := false
  /-- To mark an item that has been added freshly in this level. -/
  new := false
  /-- hide the item in the inventory display -/
  hidden := false
  /-- hover text -/
  altTitle : String := default
deriving ToJson, FromJson, Repr, Inhabited

def InventoryItem.toTile (item : InventoryItem) : InventoryTile := {
      name := item.name,
      displayName := item.displayName
      category := item.category
}

/-- The extension that stores the doc templates. Note that you can only add, but never modify
entries! -/
initialize inventoryTemplateExt :
    SimplePersistentEnvExtension InventoryTemplate (Array InventoryTemplate) ←
  registerSimplePersistentEnvExtension {
    name := `inventory_keys
    addEntryFn := Array.push
    addImportedFn := Array.flatMap id }

/-- Receive the template with that matches `(name, type)` -/
def getInventoryTemplate? [Monad m] [MonadEnv m] (n : Name) (type : InventoryType) :
    m (Option InventoryTemplate) := do
  return (inventoryTemplateExt.getState (← getEnv)).find? (fun x => x.name == n && x.type == type)

/-- The extension that contains the inventory content after it has been processed.
`MakeGame` is the only command adding items here. -/
initialize inventoryExt : SimplePersistentEnvExtension InventoryItem (Array InventoryItem) ←
  registerSimplePersistentEnvExtension {
    name := `inventory_doc
    addEntryFn := Array.push
    addImportedFn := Array.flatMap id }

/-- Receive the item with that matches `(name, type)` -/
def getInventoryItem? [Monad m] [MonadEnv m] (n : Name) (type : InventoryType) :
    m (Option InventoryItem) := do
  return (inventoryExt.getState (← getEnv)).find? (fun x => x.name == n && x.type == type)

structure InventoryOverview where
  tactics : Array InventoryTile
  lemmas : Array InventoryTile
  definitions : Array InventoryTile
  lemmaTab : Option String
deriving ToJson, FromJson

-- TODO: Reuse the following code for checking available tactics in user code:
structure UsedInventory where
(tactics : HashSet Name := {})
(definitions : HashSet Name := {})
(lemmas : HashSet Name := {})

/-! ## Environment extensions for game specification -/

/-- Register a (non-persistent) environment extension to hold the current level -/
initialize curGameExt : EnvExtension (Option Name) ← registerEnvExtension (pure none)
/-- Register a (non-persistent) environment extension to hold the current level -/
initialize curWorldExt : EnvExtension (Option Name) ← registerEnvExtension (pure none)
/-- Register a (non-persistent) environment extension to hold the current level -/
initialize curLevelExt : EnvExtension (Option Nat) ← registerEnvExtension (pure none)

/--
A game has three layers: Game, World, Levels. These are set with the commands
`Game`, `World`, and `Level`. Commands like `Introduction` depend on the current level.
-/
inductive Layer where
| Game | World | Level

variable {m: Type → Type} [Monad m] [MonadEnv m]

/-- Set the current game -/
def setCurGameId (game : Name) : m Unit :=
  modifyEnv (curGameExt.setState · game)

/-- Set the current world -/
def setCurWorldId (world : Name) : m Unit :=
  modifyEnv (curWorldExt.setState · world)

/-- Set the current level -/
def setCurLevelIdx (level : Nat) : m Unit :=
  modifyEnv (curLevelExt.setState · level)

/-- Get the current layer. -/
def getCurLayer [MonadError m] : m Layer := do
  -- previously, we also had `curGameExt.getState (← getEnv), ` in here, which got removed
  -- when we made the `Game` command optional
  match curWorldExt.getState (← getEnv), curLevelExt.getState (← getEnv) with
  | some _, some _ => return Layer.Level
  | some _, none => return Layer.World
  | none, none => return Layer.Game
  | _, _ => throwError "Invalid Layer"

/-- Get the current game, or default if none is specified -/
def getCurGameId [Monad m] : m Name := do
  match curGameExt.getState (← getEnv) with
  | some game => return game
  | none => return defaultGameName

/-- Get the current world -/
def getCurWorldId [MonadError m] : m Name := do
  match curWorldExt.getState (← getEnv) with
  | some world => return world
  | none => throwError "Current world not set"

/-- Get the current level -/
def getCurLevelIdx [MonadError m] : m Nat := do
  match curLevelExt.getState (← getEnv) with
  | some level => return level
  | none => throwError "Current level not set"

/-! ## Levels -/

structure LevelId where
  game : Name
  world : Name
  level : Nat
deriving Inhabited

instance : ToString LevelId := ⟨fun id =>
  s!"{id.game}:{id.world}:{id.level}"⟩

structure InventoryInfo where
  /-- inventory items used by the main sample solution of this level -/
  used : Array Name
  /-- new inventory items introduced by this level -/
  new : Array Name
  /-- inventory items that shall not be displayed in the inventory -/
  hidden : Array Name
  /-- inventory items exceptionally forbidden in this level -/
  disabled : Array Name
  /-- only these inventory items are allowed in this level (ignored if empty) -/
  only : Array Name
  /-- inventory items in this level (computed by `MakeGame`) -/
  tiles : Array InventoryTile
deriving ToJson, FromJson, Repr, Inhabited

def getCurLevelId [MonadError m] : m LevelId := do
  return { game := ← getCurGameId, world := ← getCurWorldId, level := ← getCurLevelIdx}

/-- Instance to make GameLevel Repr work -/
instance : Repr Elab.Command.Scope := ⟨fun s _ => repr s.currNamespace⟩

structure VisualGoalInfo where
  position : String
  arrow : Bool
  goal : Option String := none
  /-- If set, the info is only displayed while the active goal contains a
  hypothesis whose type matches this string (compared after Visual Lean's
  formula-text normalization). -/
  requireHypType : Option String := none
  /-- If set, the info is only displayed while the active goal does *not*
  contain a hypothesis whose type matches this string. -/
  excludeHypType : Option String := none
  /-- Shown only while its goal matches, even in a game with `VisualPersistentHints`,
  where hints otherwise stay up after the proof moves on. -/
  onlyWhile : Bool := false
  text : String
deriving Inhabited, Repr, ToJson, FromJson

structure VisualTransformInfo where
  kind : String
  side : Option String := none
  source : String := ""
  target : String := ""
  goal : Option String := none
  text : String
deriving Inhabited, Repr, ToJson, FromJson

structure VisualTacticHypInfo where
  tactic : String
  hyp : String
  goal : Option String := none
  text : String
deriving Inhabited, Repr, ToJson, FromJson

structure VisualHypGoalInfo where
  hyp : String
  goal : Option String := none
  /-- Where the callout arrow terminates. Older metadata defaults to the goal. -/
  target : String := "goal"
  /-- For hypothesis-anchored callouts, hide once the hypothesis type changes. -/
  hypType : Option String := none
  /-- If set, the info is only displayed while the active goal does *not* contain a
  hypothesis whose type matches this string. -/
  excludeHypType : Option String := none
  text : String
deriving Inhabited, Repr, ToJson, FromJson

structure VisualProofGraphInfo where
  goal : Option String := none
  /-- `left` of the proof-stream graph (older metadata) or `below` it. -/
  position : String := "left"
  text : String
deriving Inhabited, Repr, ToJson, FromJson

/-- Guidance in the specialization view, where a player fills in the variable of a `∀`
statement. `term` is the term built so far, as displayed, with `?` for each empty slot;
`none` matches any term. -/
structure VisualSpecializationInfo where
  /-- `info` (text only), `brick` (an arrow from the brick labelled `brick` to the first
  empty slot) or `done` (an arrow to the Done button). -/
  kind : String
  term : Option String := none
  brick : String := ""
  /-- If set, only while the goal being specialized for reads this. -/
  goal : Option String := none
  text : String
deriving Inhabited, Repr, ToJson, FromJson

structure GameLevel where
  index: Nat
  /-- The title of the level. -/
  title: String := default
  /-- Introduction text shown all the time. (markdown) -/
  introduction: String := default
  conclusion: String := default
  /-- The name of the exercise proven. If provided this lemma will be available in
  future levels. -/
  statementName: Name := default
  /-- True if the statement is a `Prop`. Used to add the statement correctly as
  `theorem` or as `def`. -/
  isProp: Bool := true
  hints: Array GoalHintEntry := default
  /-- The statement in Lean. -/
  goal : TSyntax `Lean.Parser.Command.declSig := default
  scope : Elab.Command.Scope := default
  /-- The mathematical statement in mathematician-readable form. (markdown) -/
  descrText: Option String := none
  descrFormat : String := default
  /-- The `category` of lemmas to be open by default -/
  lemmaTab: Option String := none
  /-- The module to be imported when playing this level -/
  module : Name := default
  tactics: InventoryInfo := default
  definitions: InventoryInfo := default
  lemmas: InventoryInfo := default
  /-- A proof template that is printed in an empty editor. -/
  template: Option String := none
  /-- The image for this level. -/
  image : String := default
  /-- A sequence of tactics the game automatically executes before the first step. -/
  preamble : TSyntax `Lean.Parser.Tactic.tacticSeq := default
  /-- When true, Visual Lean hides this level from navigation and the world map. -/
  visualSkipLevel : Bool := false
  /-- When true, this optional level is playable but is not required for world/game completion. -/
  completionNeutral : Bool := false
  /-- Optional Visual Lean label overriding the numeric display for special levels. -/
  visualLevelNumber? : Option String := none
  /-- Optional Visual Lean color scheme name for special level styling. -/
  visualColorScheme? : Option String := none
  /-- Whether Visual Lean should treat this level as a dramatic/boss-style opening. -/
  visualDramaticStart : Bool := false
  /-- Names of tactics/theorems to highlight in the Visual Lean inventory tray. -/
  visualEmphasize : Array Name := #[]
  /-- Visual Lean-only tactics introduced by this level. -/
  visualTacticUnlocks : Array Name := #[]
  /-- Visual Lean-only tactics available in this level after inherited unlocks. -/
  visualTactics : Array Name := #[]
  /-- Visual Lean instructional callouts attached to the proof goal card. -/
  visualGoalInfos : Array VisualGoalInfo := #[]
  /-- Visual Lean instructional callouts attached to transformation mode. -/
  visualTransformInfos : Array VisualTransformInfo := #[]
  /-- Visual Lean instructional callouts linking a tactic card to a hypothesis card. -/
  visualTacticHypInfos : Array VisualTacticHypInfo := #[]
  /-- Visual Lean instructional callouts linking a hypothesis card to the goal card. -/
  visualHypGoalInfos : Array VisualHypGoalInfo := #[]
  /-- Visual Lean instructional callouts attached to the proof-stream graph. -/
  visualProofGraphInfos : Array VisualProofGraphInfo := #[]
  /-- Visual Lean instructional callouts in the specialization view. -/
  visualSpecializeInfos : Array VisualSpecializationInfo := #[]
  /-- When true, Visual Lean treats this level as text only: the path-style world map
  shows its introduction in a dialog, and closing the dialog completes the level. -/
  visualTextLevel : Bool := false
  /-- When true, Visual Lean opens this level in Rewrite Mode on the goal and keeps it
  there; a check-mark button closes the goal once both sides match. -/
  visualRewriteOnly : Bool := false
  /-- When true, Visual Lean hides Rewrite Mode's rewrite-direction button. -/
  visualHideRewriteDirection : Bool := false
  /-- Rule cards whose `∀ …` footer Visual Lean highlights in Rewrite Mode. -/
  visualEmphasizeForall : Array Name := #[]
  /-- When true, the path-style world map draws this level's node larger. -/
  visualBossLevel : Bool := false
  /-- When true, Visual Lean writes multiplication as `·` in Rewrite Mode. -/
  visualMulDot : Bool := false
  /-- When true, Visual Lean hides Rewrite Mode's swap-sides button. -/
  visualHideSwapSides : Bool := false
  /-- When true, Visual Lean refuses Rewrite Mode on the goal, with a warning. -/
  visualNoRewriteMode : Bool := false
deriving Inhabited, Repr

/-- Json-encodable version of `GameLevel`
Fields:
- description: Lemma in mathematical language.
- descriptionGoal: Lemma printed as Lean-Code.
-/
structure LevelInfo where
  index : Nat
  title : String
  tactics : Array InventoryTile
  lemmas : Array InventoryTile
  definitions : Array InventoryTile
  introduction : String
  conclusion : String
  descrText : Option String := none
  descrFormat : String := ""
  lemmaTab : Option String
  module : Name
  displayName : Option String
  statementName : Option String
  template : Option String
  image: Option String
  visualSkipLevel : Bool := false
  completionNeutral : Bool := false
  visualLevelNumber? : Option String := none
  visualColorScheme? : Option String := none
  visualDramaticStart : Bool := false
  visualEmphasize : Array String := #[]
  visualTactics : Array String := #[]
  visualGoalInfos : Array VisualGoalInfo := #[]
  visualTransformInfos : Array VisualTransformInfo := #[]
  visualTacticHypInfos : Array VisualTacticHypInfo := #[]
  visualHypGoalInfos : Array VisualHypGoalInfo := #[]
  visualProofGraphInfos : Array VisualProofGraphInfo := #[]
  visualSpecializeInfos : Array VisualSpecializationInfo := #[]
  visualTextLevel : Bool := false
  visualRewriteOnly : Bool := false
  visualHideRewriteDirection : Bool := false
  visualEmphasizeForall : Array String := #[]
  visualBossLevel : Bool := false
  visualMulDot : Bool := false
  visualHideSwapSides : Bool := false
  visualNoRewriteMode : Bool := false
deriving ToJson, FromJson

def GameLevel.toInfo (lvl : GameLevel) (env : Environment) : LevelInfo :=
  { index := lvl.index,
    title := lvl.title,
    tactics := lvl.tactics.tiles,
    lemmas := lvl.lemmas.tiles,
    definitions := lvl.definitions.tiles,
    descrText := lvl.descrText,
    descrFormat := lvl.descrFormat --toExpr <| format (lvl.goal.raw) --toString <| Syntax.formatStx (lvl.goal.raw) --Syntax.formatStx (lvl.goal.raw) , -- TODO
    introduction := lvl.introduction
    conclusion := lvl.conclusion
    lemmaTab := match lvl.lemmaTab with
    | some tab => tab
    | none =>
      -- Try to set the lemma tab to the category of the first added lemma
      match lvl.lemmas.tiles.find? (·.new) with
      | some tile => tile.category
      | none => none
    statementName := lvl.statementName.toString
    module := lvl.module
    displayName := match lvl.statementName with
      | .anonymous => none
      | name => match (inventoryExt.getState env).find?
          (fun x => x.name == name && x.type == .Theorem) with
        | some n => n.displayName
        | none => name.toString
        -- Note: we could call `.find!` because we check in `Statement` that the
        -- lemma doc must exist.
    template := lvl.template
    image := lvl.image
    visualSkipLevel := lvl.visualSkipLevel
    completionNeutral := lvl.completionNeutral
    visualLevelNumber? := lvl.visualLevelNumber?
    visualColorScheme? := lvl.visualColorScheme?
    visualDramaticStart := lvl.visualDramaticStart
    visualEmphasize := lvl.visualEmphasize.map (·.toString)
    visualTactics := lvl.visualTactics.map (·.toString)
    visualGoalInfos := lvl.visualGoalInfos
    visualTransformInfos := lvl.visualTransformInfos
    visualTacticHypInfos := lvl.visualTacticHypInfos
    visualHypGoalInfos := lvl.visualHypGoalInfos
    visualProofGraphInfos := lvl.visualProofGraphInfos
    visualSpecializeInfos := lvl.visualSpecializeInfos
    visualTextLevel := lvl.visualTextLevel
    visualRewriteOnly := lvl.visualRewriteOnly
    visualHideRewriteDirection := lvl.visualHideRewriteDirection
    visualEmphasizeForall := lvl.visualEmphasizeForall.map (·.toString)
    visualBossLevel := lvl.visualBossLevel
    visualMulDot := lvl.visualMulDot
    visualHideSwapSides := lvl.visualHideSwapSides
    visualNoRewriteMode := lvl.visualNoRewriteMode
  }

/-! ## World -/

/-- A world is a collection of levels, like a chapter. -/
structure World where
  /- Internal name of the world. Not visible to the player. -/
  name: Name
  /-- Display title of the world. -/
  title: String := default
  /-- World introduction to be shown before the first level is loaded. (markdown) -/
  introduction: String := default
  /-- TODO: This is currently unused. -/
  conclusion : String := default
  /-- The levels of the world. -/
  levels: HashMap Nat GameLevel := default
  /-- The introduction image of the world. -/
  image: String := default
  /-- Visual Lean path map: this world is a bonus branch sprouting from the given
  level of another world. It unlocks once that level is done and gates nothing. -/
  visualBonusOf? : Option (Name × Nat) := none
  /-- Visual Lean path map: named colour of this world's path. -/
  visualColor? : Option String := none
  /-- Visual Lean path map: column of this world's path (0 = centre, negative = left).
  For a bonus world, the column its path onwards to a later world runs down. -/
  visualMapColumn? : Option Int := none
  /-- Visual Lean path map: this world sits below every other world, as a closing level
  does (see `VisualMapBottom`). -/
  visualMapBottom : Bool := false
  /-- Visual Lean path map: this section isn't part of any named world. It is drawn
  in the shared grey and gets no title label. -/
  visualSharedPath : Bool := false
  /-- Visual Lean path map: this world carries on the path of another world, in its
  colour and without a title label of its own. -/
  visualContinues? : Option Name := none
  /-- Visual Lean: hide Rewrite Mode's swap-sides button in every level of this world. -/
  visualHideSwapSides : Bool := false
deriving Inhabited

instance : ToJson World := ⟨
  fun world => Json.mkObj <| [
    ("name", toJson world.name),
    ("title", world.title),
    ("introduction", world.introduction),
    ("image", world.image)] ++
    (match world.visualBonusOf? with
      | some (source, level) =>
        [("visualBonusOf", Json.mkObj [("world", toJson source), ("level", toJson level)])]
      | none => []) ++
    (match world.visualColor? with
      | some color => [("visualColor", toJson color)]
      | none => []) ++
    (match world.visualMapColumn? with
      | some column => [("visualMapColumn", toJson column)]
      | none => []) ++
    (if world.visualSharedPath then [("visualSharedPath", toJson true)] else []) ++
    (if world.visualMapBottom then [("visualMapBottom", toJson true)] else []) ++
    (match world.visualContinues? with
      | some source => [("visualContinues", toJson source)]
      | none => [])
⟩

/-! ## Game -/

/-- A tile as they are displayed on the servers landing page. -/
structure GameTile where
  /-- The title of the game -/
  title: String
  /-- One catch phrase about the game -/
  short: String := default
  /-- One paragraph description what the game is about -/
  long: String := default
  /-- List of languages the game supports

  TODO: What's the expectected format
  TODO: Must be a list with a single language currently
   -/
  languages: List String := default
  /-- A list of games which this one builds upon -/
  prerequisites: List String := default
  /-- Number of worlds in the game -/
  worlds: Nat := default
  /-- Number of levels in the game -/
  levels: Nat := default
  /-- A cover image of the game

  TODO: What's the format? -/
  image: String := default
deriving Inhabited, ToJson, FromJson

/-- Settings which modify the game's frontend display. -/
structure Game.Settings where
  /--
  If `true`, display two hypotheses `A : Prop` and `B : Prop`
  instead of a joint `A B : Prop`.
  -/
  unbundleHyps : Bool := false
deriving Repr, ToJson, FromJson

instance : Inhabited Game.Settings where
  default := {}

structure Game where
  /-- Internal name of the game. -/
  name : Name
  /-- TODO: currently unused. -/
  title : String := default
  /-- Text displayed on the main landing page of the game. -/
  introduction : String := default
  /-- Text displayed on the main landing page of the game. -/
  info : String := default
  /-- TODO: currently unused. -/
  conclusion : String := default
  /-- TODO: currently unused. -/
  authors : List String := default
  worlds : Graph Name World := default
  /-- The tile displayed on the server's landing page. -/
  tile : GameTile := default
  /-- The path to the background image of the world. -/
  image : String := default
  /-- Settings to individualise the game's UI. -/
  settings : Game.Settings := default
  /-- When true, Visual Lean draws the world map as paths of individual levels
  (see `VisualPathMap`) instead of worlds with orbiting level dots. -/
  visualPathMap : Bool := false
  /-- When true, Visual Lean lets a proof of `False` close any goal, as the Fast `exfalso`
  setting does, whatever that setting says. -/
  visualFastExfalso : Bool := false
  /-- When true, Visual Lean hints stay up after the proof moves past the state they
  were written for, until another hint replaces them (see `VisualPersistentHints`). -/
  visualPersistentHints : Bool := false
  /-- When true, Rewrite Mode on a goal shows the check mark once both sides match in
  every level, not only in `VisualRewriteOnly` ones (see `VisualRewriteCheck`). -/
  visualRewriteCheck : Bool := false
  /-- The name the game gives the successor function, for Visual Lean's term builder
  (see `VisualSuccessorName`). `succ` when unset. -/
  visualSuccessorName? : Option String := none
  /-- When true, clicking a goal `a = a` in Visual Lean doesn't close it: the player
  opens it in Rewrite Mode and uses the check mark (see `VisualNoGoalRfl`). -/
  visualNoGoalRfl : Bool := false
  /-- Theorems that Visual Lean shows in the axiom colour, whatever inventory tab they
  are filed under (see `VisualAxioms`). -/
  visualAxioms : Array Name := #[]
deriving Inhabited, ToJson, FromJson

def getGameJson (game : «Game») : Json := Id.run do
  let gameJson : Json := toJson game
  -- Add world sizes to Json object
  let worldSize := game.worlds.nodes.toList.map (fun (n, w) => (n.toString, w.levels.size))
  -- Add per-world arrays of skipped level indices (for Visual Lean)
  let skippedLevels := game.worlds.nodes.toList.map (fun (n, w) =>
    let skipped : List Nat := w.levels.toList
      |>.filter (fun (_, lvl) => lvl.visualSkipLevel)
      |>.map (fun (i, _) => i)
    (n.toString, toJson skipped))
  -- Add per-world arrays of optional levels which do not gate completion.
  let completionNeutralLevels := game.worlds.nodes.toList.map (fun (n, w) =>
    let neutral : List Nat := w.levels.toList
      |>.filter (fun (_, lvl) => lvl.completionNeutral)
      |>.map (fun (i, _) => i)
    (n.toString, toJson neutral))
  let gameJson := gameJson.mergeObj (Json.mkObj [
    ("worldSize", Json.mkObj worldSize),
    ("skippedLevels", Json.mkObj skippedLevels),
    ("completionNeutralLevels", Json.mkObj completionNeutralLevels),
  ])
  return gameJson

/-! ## Game environment extension -/

def HashMap.merge [BEq α] [Hashable α] (old : HashMap α β) (new : HashMap α β) (merge : β → β → β) :
  HashMap α β :=
new.fold (fun acc a b =>
  if let some bOld := acc.get? a
  then acc.insert a (merge bOld b)
  else acc.insert a b) old

def GameLevel.merge (_old : GameLevel) (new : GameLevel) : GameLevel :=
  new -- simply override old level

def World.merge (old : World) (new : World) : World :=
{ new with
  levels := HashMap.merge old.levels new.levels GameLevel.merge
  -- Level modules carry the world without its world-level settings, so keep
  -- settings that were made in another module.
  visualBonusOf? := new.visualBonusOf? <|> old.visualBonusOf?
  visualColor? := new.visualColor? <|> old.visualColor?
  visualMapColumn? := new.visualMapColumn? <|> old.visualMapColumn?
  visualSharedPath := new.visualSharedPath || old.visualSharedPath
  visualMapBottom := new.visualMapBottom || old.visualMapBottom
  visualContinues? := new.visualContinues? <|> old.visualContinues?
  visualHideSwapSides := new.visualHideSwapSides || old.visualHideSwapSides }

def Game.merge (old : Game) (new : Game) : Game :=
{ new with
  worlds := {
    nodes := HashMap.merge old.worlds.nodes new.worlds.nodes World.merge
    edges := Id.run do
      let mut res := old.worlds.edges
      for e in new.worlds.edges do
        if ¬ res.contains e then
          res := res.push e
      return res
  } }

initialize gameExt : PersistentEnvExtension (Name × Game) (Name × Game) (HashMap Name Game) ←
  do registerPersistentEnvExtension {
    name          := `gameExt,
    mkInitial     := pure {},
    addImportedFn := fun ess => do
      let mut games := {}
      for es in ess do
        for (name, game) in es do
          match games.get? name with
          | some oldgame =>
            games := games.insert name (Game.merge oldgame game)
          | none =>
            games := games.insert name game
      return games
    addEntryFn    := (λ s n => s.insert n.1 n.2),
    exportEntriesFn := HashMap.toArray,
    statsFn := fun s => format "number of local entries: " ++ format s.size,
    asyncMode := .sync
}

def getGame? (n : Name) : m (Option Game) := do
  return (gameExt.getState (← getEnv)).get? n

def insertGame (n : Name) (g : Game) : m Unit := do
  modifyEnv (gameExt.addEntry · (n, g))

def getLevel? (levelId : LevelId) : m (Option GameLevel) := do
  let some game ← getGame? levelId.game
    | return none
  let some world := game.worlds.nodes.get? levelId.world
    | return none
  let some level := world.levels.get? levelId.level
    | return none
  return level

def getCurGame [Monad m] : m Game := do
  let some game ← getGame? (← getCurGameId)
    | let game := {name := defaultGameName}
      insertGame defaultGameName game
      return game
  return game

def modifyCurGame (fn : Game → m Game) [MonadError m] : m Unit := do
  let game ← getCurGame
  insertGame game.name (← fn game)

def addWorld (world : World) [MonadError m] : m Unit := do
  modifyCurGame fun game => do
    return {game with worlds := game.worlds.insertNode world.name world}

def getCurWorld [MonadError m] : m World := do
  let some world := (← getCurGame).worlds.nodes.get? (← getCurWorldId)
    | throwError m!"World {← getCurWorldId} does not exist"
  return world

def modifyCurWorld (fn : World → m World) [MonadError m] : m Unit := do
  modifyCurGame fun game => do
    let world ← getCurWorld
    return {game with worlds := {game.worlds with nodes := game.worlds.nodes.insert world.name (← fn world) }}

def addLevel (level : GameLevel) [MonadError m] : m Unit := do
  let worldId ← getCurWorldId
  match ← getLevel? ⟨← getCurGameId, worldId, level.index⟩ with
  | some _existingLevel =>
    throwError m!"Level {level.index} already exists for world {worldId}!"
  | none =>
    modifyCurWorld fun world => do
      return {world with levels := world.levels.insert level.index level}

def getCurLevel [MonadError m] : m GameLevel := do
  let some level := (← getCurWorld).levels.get? (← getCurLevelIdx)
    | throwError m!"Level {← getCurLevelIdx} does not exist"
  return level

def modifyCurLevel (fn : GameLevel → m GameLevel) [MonadError m] : m Unit := do
  modifyCurWorld fun world => do
    let level ← getCurLevel
    return {world with levels := world.levels.insert level.index (← fn level)}

def modifyLevel (levelId : LevelId) (fn : GameLevel → m GameLevel) [MonadError m] : m Unit := do
  let some game ← getGame? levelId.game
    | throwError m!"Game {levelId.game} does not exist"
  let some world := (← getCurGame).worlds.nodes.get? levelId.world
    | throwError m!"World {levelId.world} does not exist"
  let some level := world.levels.get? levelId.level
    | throwError m!"Level {levelId.level} does not exist"
  let level' ← fn level
  let world' := {world with levels := world.levels.insert levelId.level level'}
  let game' := {game with worlds := game.worlds.insertNode levelId.world world'}
  insertGame levelId.game game'
