import { createSlice } from "@reduxjs/toolkit";

import { loadPreferences, loadVisualAutoBranchSwitchPreference, loadVisualLightModePreference } from "./local_storage";

export interface PreferencesState {
  layout: "mobile" | "auto" | "desktop";
  isSavePreferences: boolean;
  language: string;
  isSuggestionsMobileMode: boolean;
  isVisualLightMode: boolean;
  isVisualAutoBranchSwitching: boolean;
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
}

const savedPreferences = loadPreferences()
const savedVisualLightMode = loadVisualLightModePreference()
const savedVisualAutoBranchSwitching = loadVisualAutoBranchSwitchPreference()

const initialState: PreferencesState = {
  ...defaultPreferencesState,
  ...savedPreferences,
  isVisualLightMode: savedVisualLightMode ?? savedPreferences?.isVisualLightMode ?? defaultPreferencesState.isVisualLightMode,
  isVisualAutoBranchSwitching: savedVisualAutoBranchSwitching ?? savedPreferences?.isVisualAutoBranchSwitching ?? defaultPreferencesState.isVisualAutoBranchSwitching,
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
  },
});

export const {
  setLayout,
  setIsSavePreferences,
  setLanguage,
  setIsSuggestionsMobileMode,
  setIsVisualLightMode,
  setIsVisualAutoBranchSwitching,
} = preferencesSlice.actions;
