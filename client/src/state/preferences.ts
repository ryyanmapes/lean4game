import { createSlice } from "@reduxjs/toolkit";

import { loadPreferences } from "./local_storage";

export interface PreferencesState {
  layout: "mobile" | "auto" | "desktop";
  isSavePreferences: boolean;
  language: string;
  isSuggestionsMobileMode: boolean;
  isVisualLightMode: boolean;
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
}

const initialState: PreferencesState = {
  ...defaultPreferencesState,
  ...loadPreferences(),
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
  },
});

export const {
  setLayout,
  setIsSavePreferences,
  setLanguage,
  setIsSuggestionsMobileMode,
  setIsVisualLightMode,
} = preferencesSlice.actions;
