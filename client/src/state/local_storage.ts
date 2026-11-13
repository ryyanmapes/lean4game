/**
 * @fileOverview Load/save the state to the local browser store
 */

const KEY = "game_progress";
const VISUAL_AUTO_BRANCH_SWITCH_KEY = "visual_auto_branch_switch";
const VISUAL_FAST_EXFALSO_KEY = "visual_fast_exfalso";
const VISUAL_OPEN_ANY_LEVEL_KEY = "visual_open_any_level";

/** Load from browser storage */
export function loadState() {
  try {
    const serializedState = localStorage.getItem(KEY);
    if (!serializedState) return undefined;
    let x = JSON.parse(serializedState);
    // Compatibility: `state.level` has been renamed to `x.games`.
    if (x.level) {
      x.games = x.level
      x.level = undefined
    }
    // Compatibility: code has been moved to `data` and inventory has been added.
    for (var gameState in x.games) {
      if (!x.games[gameState].data) {
        x.games[gameState] = null
      }
    }
    return x
  } catch (e) {
    return undefined;
  }
}

/** Save to browser storage */
export async function saveState(state: any) {
  try {
    const serializedState = JSON.stringify(state)
    localStorage.setItem(KEY, serializedState);
  } catch (e) {
    // Ignore
  }
}

const PREFERENCES_KEY = "preferences"
const VISUAL_LIGHT_MODE_KEY = "visual_light_mode"

/** Load from browser storage */
export function loadPreferences() {
  try {
    const serializedState = localStorage.getItem(PREFERENCES_KEY);
    return JSON.parse(serializedState)
  } catch (e) {
    return undefined;
  }
}

export function savePreferences(state: any) {
  try {
    const serializedState = JSON.stringify(state)
    localStorage.setItem(PREFERENCES_KEY, serializedState);
  } catch (e) {
    // Ignore
  }
}

export function removePreferences() {
  try {
    localStorage.removeItem(PREFERENCES_KEY);
  } catch (e) {
    // Ignore
  }
}

export function loadVisualLightModePreference() {
  try {
    const serializedState = localStorage.getItem(VISUAL_LIGHT_MODE_KEY)
    if (serializedState === null) return undefined

    const parsedState = JSON.parse(serializedState)
    return typeof parsedState === 'boolean' ? parsedState : undefined
  } catch (e) {
    return undefined
  }
}

/** A game whose map offers the theme toggle stores its own choice, so it can't
 * strand a player in another game that has no toggle. `index.html` reads this
 * key too, to paint the page's background before the app has loaded. */
function gameLightModeKey(gameId: string) {
  return `${VISUAL_LIGHT_MODE_KEY}/${gameId}`
}

/** The game in the page's address, for what has to be known before the app renders. */
export function gameIdFromLocation(): string | null {
  return /\bg\/[^/#?]+\/[^/#?]+/.exec(window.location.pathname + window.location.hash)?.[0] ?? null
}

export function loadGameLightModePreference(gameId: string): boolean {
  try {
    return localStorage.getItem(gameLightModeKey(gameId)) === 'true'
  } catch (e) {
    return false
  }
}

export function saveGameLightModePreference(gameId: string, isLightMode: boolean) {
  try {
    localStorage.setItem(gameLightModeKey(gameId), String(isLightMode))
  } catch (e) {
    // Ignore
  }
}

export function saveVisualLightModePreference(isVisualLightMode: boolean) {
  try {
    localStorage.setItem(VISUAL_LIGHT_MODE_KEY, JSON.stringify(isVisualLightMode))
  } catch (e) {
    // Ignore
  }
}

export function loadVisualAutoBranchSwitchPreference() {
  try {
    const value = localStorage.getItem(VISUAL_AUTO_BRANCH_SWITCH_KEY)
    if (value === null) return undefined
    const parsed = JSON.parse(value)
    return typeof parsed === 'boolean' ? parsed : undefined
  } catch (_error) {
    return undefined
  }
}

export function saveVisualAutoBranchSwitchPreference(enabled: boolean) {
  try {
    localStorage.setItem(VISUAL_AUTO_BRANCH_SWITCH_KEY, JSON.stringify(enabled))
  } catch (_error) {
    // Ignore unavailable storage.
  }
}


export function loadVisualFastExfalsoPreference() {
  try {
    const value = localStorage.getItem(VISUAL_FAST_EXFALSO_KEY)
    if (value === null) return undefined
    const parsed = JSON.parse(value)
    return typeof parsed === 'boolean' ? parsed : undefined
  } catch (_error) {
    return undefined
  }
}

export function saveVisualFastExfalsoPreference(enabled: boolean) {
  try {
    localStorage.setItem(VISUAL_FAST_EXFALSO_KEY, JSON.stringify(enabled))
  } catch (_error) {
    // Ignore unavailable storage.
  }
}

export function loadVisualOpenAnyLevelPreference() {
  try {
    const value = localStorage.getItem(VISUAL_OPEN_ANY_LEVEL_KEY)
    if (value === null) return undefined
    const parsed = JSON.parse(value)
    return typeof parsed === 'boolean' ? parsed : undefined
  } catch (_error) {
    return undefined
  }
}

export function saveVisualOpenAnyLevelPreference(enabled: boolean) {
  try {
    localStorage.setItem(VISUAL_OPEN_ANY_LEVEL_KEY, JSON.stringify(enabled))
  } catch (_error) {
    // Ignore unavailable storage.
  }
}
