/**
 * @fileOverview Define API of the server-client communication
*/
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { retry } from '@reduxjs/toolkit/query'
import { InventoryTab } from '../store/inventory-atoms'
import { getDataBaseUrl } from '../utils/url'


export interface GameTile {
  title: string
  short: string
  long: string
  languages: Array<string>
  prerequisites: Array<string>
  worlds: number
  levels: number
  image: string
}

/** A world of the game graph, with its Visual Lean path-map settings. */
export interface VisualWorldNode {
  id: string,
  title: string,
  introduction: string,
  image: string,
  /** Bonus branch off this level of another world (`VisualBonusOf`). */
  visualBonusOf?: { world: string, level: number },
  /** Named path colour (`VisualWorldColor`). */
  visualColor?: string,
  /** Map column: 0 is the centre, negative is left (`VisualMapColumn`). For a bonus
   * world, the column its path onwards runs down. */
  visualMapColumn?: number,
  /** Sits below every other world, as a closing level does (`VisualMapBottom`). */
  visualMapBottom?: boolean,
  /** Not part of any named world: grey and unlabelled (`VisualSharedPath`). */
  visualSharedPath?: boolean,
  /** Carries on another world's path: its colour, no label (`VisualContinues`). */
  visualContinues?: string,
}

export interface GameInfo {
  title: null|string,
  introduction: null|string,
  info: null|string,
  worlds: null|{nodes: {[id:string]: VisualWorldNode}, edges: string[][]},
  worldSize: null|{[key: string]: number},
  skippedLevels?: {[key: string]: number[]},
  completionNeutralLevels?: {[key: string]: number[]},
  authors: null|string[],
  conclusion: null|string,
  tile: null|GameTile,
  image: null|string
  settings: {
    unbundleHyps: boolean,
  } | undefined
  /** Visual Lean draws the world map as paths of individual levels (`VisualPathMap`). */
  visualPathMap?: boolean
  /** A proof of `False` closes any goal in this game (`VisualFastExfalso`). */
  visualFastExfalso?: boolean
  /** Hints stay up after the proof moves on (`VisualPersistentHints`). */
  visualPersistentHints?: boolean
  /** Rewrite Mode on a goal shows the check mark in every level (`VisualRewriteCheck`). */
  visualRewriteCheck?: boolean
  /** The successor function's name for the term builder (`VisualSuccessorName`). */
  visualSuccessorName?: string
  /** Clicking a goal `a = a` doesn't close it (`VisualNoGoalRfl`). */
  visualNoGoalRfl?: boolean
  /** Theorems shown in the axiom colour (`VisualAxioms`), by full name. */
  visualAxioms?: string[]
}

export interface InventoryTile {
  name: string,
  displayName: string,
  category: string,
  disabled: boolean,
  locked: boolean,
  new: boolean,
  hidden: boolean
  altTitle: string,
  world : string|null,
  level : number|null,
  declIndex : number|null,
  proven : boolean
}

export interface LevelInfo {
  title: null|string,
  introduction: null|string,
  conclusion: null|string,
  index: number,
  tactics: InventoryTile[],
  lemmas: InventoryTile[],
  definitions: InventoryTile[],
  descrText: null|string,
  descrFormat: null|string,
  lemmaTab: null|string,
  statementName: null|string,
  displayName: null|string,
  template: null|string,
  image: null|string,
  completionNeutral?: boolean,
  visualGoalInfos?: Array<{ position: 'above' | 'below'; arrow: boolean; goal?: string | null; text: string }>,
  visualTransformInfos?: Array<{ kind: 'side' | 'rewrite' | 'back' | 'reverse' | 'swap' | 'info' | 'check'; side?: 'left' | 'right' | null; source?: string; target?: string; goal?: string | null; text: string }>,
  visualTacticHypInfos?: Array<{ tactic: string; hyp: string; goal?: string | null; text: string }>,
  visualHypGoalInfos?: Array<{ hyp: string; goal?: string | null; text: string }>,
  visualProofGraphInfos?: Array<{ goal?: string | null; text: string }>
  /** Text-only level: the path map shows its introduction in a dialog (`VisualTextLevel`). */
  visualTextLevel?: boolean,
  /** Opens in Rewrite Mode on the goal and stays there (`VisualRewriteOnly`). */
  visualRewriteOnly?: boolean,
  /** Hide Rewrite Mode's rewrite-direction button (`VisualHideRewriteDirection`). */
  visualHideRewriteDirection?: boolean,
  /** Rule cards whose `∀ …` footer is highlighted (`VisualEmphasizeForall`). */
  visualEmphasizeForall?: string[],
  /** Draw the level's node larger on the path map (`VisualBossLevel`). */
  visualBossLevel?: boolean,
  /** Write multiplication as `·` in Rewrite Mode (`VisualMulDot`). */
  visualMulDot?: boolean,
  /** Hide Rewrite Mode's swap-sides button (`VisualHideSwapSides`). */
  visualHideSwapSides?: boolean,
  /** Rewrite Mode on the goal is refused with a warning (`VisualNoRewriteMode`). */
  visualNoRewriteMode?: boolean,
  /** Rewrite Mode has no tabs (`VisualNoRewriteTabs`). */
  visualNoRewriteTabs?: boolean,
  /** Rewrite Mode has no Hypotheses tab (`VisualNoHypothesesTab`). */
  visualNoHypothesesTab?: boolean,
  /** The tab Rewrite Mode opens on, by its label (`VisualStartTab`). */
  visualStartTab?: string | null,
  /** Uses of a tactic along one branch of the proof (`VisualTacticUses`). */
  visualTacticUses?: Array<{ tactic: string; uses: number }>,
}

/** Used to display the inventory on the welcome page */
export interface InventoryOverview {
  tactics: InventoryTile[],
  lemmas: InventoryTile[],
  definitions: InventoryTile[],
  lemmaTab: null,
}

interface Doc {
  name: string,
  displayName: string,
  content: string,
  statement: string,
  theoremKind?: "equality" | "proposition",
  type: string, // TODO: can I remove these?
  category: string,
}

const baseQuery = retry(
  fetchBaseQuery({ baseUrl: getDataBaseUrl() }),
  { maxRetries: 5 },
)

// Define a service using a base URL and expected endpoints
export const apiSlice = createApi({
  reducerPath: 'gameApi',
  // The relay can still be warming up when CI hits the first page load.
  baseQuery,
  endpoints: (builder) => ({
    getGameInfo: builder.query<GameInfo, {game: string}>({
      query: ({game}) => `${game}/game.json`,
    }),
    loadLevel: builder.query<LevelInfo, {game: string, world: string, level: number}>({
      query: ({game, world, level}) => `${game}/level__${world}__${level}.json`,
    }),
    loadInventoryOverview: builder.query<InventoryOverview, {game: string}>({
      query: ({game}) => `${game}/inventory.json`,
    }),
    loadDoc: builder.query<Doc, {game: string, name: string, type: InventoryTab}>({
      query: ({game, type, name}) => `${game}/doc__${capitalizeFirstLetter(type)}__${name}.json`,
    }),
    // backwards compatibility
    loadDocLegacy: builder.query<Doc, {game: string, name: string, type: "lemma" | "tactic" | "definition" }>({
      query: ({game, type, name}) => `${game}/doc__${capitalizeFirstLetter(type)}__${name}.json`,
    }),
  }),
})

// Export hooks for usage in functional components, which are
// auto-generated based on the defined endpoints
export const { useGetGameInfoQuery, useLoadLevelQuery, useLoadDocQuery, useLoadDocLegacyQuery, useLoadInventoryOverviewQuery } = apiSlice

function capitalizeFirstLetter(val) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}
