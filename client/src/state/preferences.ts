import { createSlice } from "@reduxjs/toolkit";

import { gameIdFromLocation, loadGameLightModePreference, loadPreferences, loadVisualAutoBranchSwitchPreference, loadVisualFastExfalsoPreference, loadVisualOpenAnyLevelPreference } from "./local_storage";

export interface PreferencesState {
  layout: "mobile" | "auto" | "desktop";
  isSavePreferences: boolean;
  language: string;
  isSuggestionsMobileMode: boolean;
  isVisualLightMode: boolean;
  isVisualAutoBranchSwitching: boolean;
  isVisualFastExfalso: boolean;
  /** Let the visual map and Next button open levels the player hasn't unlocked. */
  isVisualOpenAnyLevel: boolean;
}

export function getWindowDimensions() {
  const {innerWidth: width, innerHeight: height } = window
  return {width, height}
}

export const AUTO_SWITCH_THRESHOLD = 800

const defaultPreferencesState: PreferencesState = {
  layout: "auto",
  isSavePreferences: false,
  language: import.meta.env.VITE_CLIENT_DEFAULT_LANGUAGE || "en",
  isSuggestionsMobileMode: 'ontouchstart' in document.documentElement,
  isVisualLightMode: false,
  isVisualAutoBranchSwitching: false,
  isVisualFastExfalso: false,
  isVisualOpenAnyLevel: false,
}

const savedPreferences = loadPreferences()
const savedVisualAutoBranchSwitching = loadVisualAutoBranchSwitchPreference()
const savedVisualFastExfalso = loadVisualFastExfalsoPreference()
const savedVisualOpenAnyLevel = loadVisualOpenAnyLevelPreference()
const initialGameId = gameIdFromLocation()

const initialState: PreferencesState = {
  ...defaultPreferencesState,
  ...savedPreferences,
  // Light mode is stored per game, for the games that offer its toggle on their
  // map. A preference stored under the old global key no longer applies, rather
  // than stranding anyone in a theme with no control to leave it by. It's read here
  // for the page's game, so the first frame is right; `App` follows game changes.
  isVisualLightMode: initialGameId ? loadGameLightModePreference(initialGameId) : false,
  isVisualAutoBranchSwitching: savedVisualAutoBranchSwitching ?? savedPreferences?.isVisualAutoBranchSwitching ?? defaultPreferencesState.isVisualAutoBranchSwitching,
  isVisualFastExfalso: savedVisualFastExfalso ?? savedPreferences?.isVisualFastExfalso ?? defaultPreferencesState.isVisualFastExfalso,
  isVisualOpenAnyLevel: savedVisualOpenAnyLevel ?? savedPreferences?.isVisualOpenAnyLevel ?? defaultPreferencesState.isVisualOpenAnyLevel,
}

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    setLayout: (state, action) => {
      state.layout = action.payload;
    },
    setIsSavePreferences: (state, action) => {
      state.isSavePreferences = action.payload;
    },
    setLanguage: (state, action) => {
      state.language = action.payload;
    },
    setIsSuggestionsMobileMode: (state, action) => {
      state.isSuggestionsMobileMode = action.payload;
    },
    setIsVisualLightMode: (state, action) => {
      state.isVisualLightMode = action.payload;
    },
    setIsVisualAutoBranchSwitching: (state, action) => {
      state.isVisualAutoBranchSwitching = action.payload;
    },
    setIsVisualFastExfalso: (state, action) => {
      state.isVisualFastExfalso = action.payload;
    },
    setIsVisualOpenAnyLevel: (state, action) => {
      state.isVisualOpenAnyLevel = action.payload;
    },
  },
});

export const {
  setLayout,
  setIsSavePreferences,
  setLanguage,
  setIsSuggestionsMobileMode,
  setIsVisualLightMode,
  setIsVisualAutoBranchSwitching,
  setIsVisualFastExfalso,
  setIsVisualOpenAnyLevel,
} = preferencesSlice.actions;
