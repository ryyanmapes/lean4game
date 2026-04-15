/**
 * @fileOverview Load/save the state to the local browser store
 */

const KEY = "game_progress";

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

export function saveVisualLightModePreference(isVisualLightMode: boolean) {
  try {
    localStorage.setItem(VISUAL_LIGHT_MODE_KEY, JSON.stringify(isVisualLightMode))
  } catch (e) {
    // Ignore
  }
}

