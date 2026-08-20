import React, { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import {
    PreferencesState,
    setLayout as setPreferencesLayout,
    setIsSavePreferences as setPreferencesIsSavePreferences,
    setLanguage as setLanguagePreferences,
    setIsSuggestionsMobileMode as setIsSuggestionsMobileModePreferences,
    setIsVisualLightMode as setIsVisualLightModePreferences,
    setIsVisualAutoBranchSwitching as setIsVisualAutoBranchSwitchingPreferences,
    setIsVisualFastExfalso as setIsVisualFastExfalsoPreferences,
    getWindowDimensions,
    AUTO_SWITCH_THRESHOLD
} from "../preferences";


const UsePreferences = () => {
    const dispatch = useAppDispatch()
    const [mobile, setMobile] = React.useState<boolean>()

    const layout = useAppSelector((state) => state.preferences.layout);
    const setLayout = (layout: PreferencesState["layout"]) => dispatch(setPreferencesLayout(layout))

    const isSavePreferences = useAppSelector((state) => state.preferences.isSavePreferences);
    const setIsSavePreferences = (isSave: boolean) => dispatch(setPreferencesIsSavePreferences(isSave))

    const language = useAppSelector((state) => state.preferences.language);
    const setLanguage = (lang: string) => dispatch(setLanguagePreferences(lang))

    const isSuggestionsMobileMode = useAppSelector((state) => state.preferences.isSuggestionsMobileMode);
    const setIsSuggestionsMobileMode = (isSuggestionsMobileMode: boolean) => dispatch(setIsSuggestionsMobileModePreferences(isSuggestionsMobileMode))

    const isVisualLightMode = useAppSelector((state) => state.preferences.isVisualLightMode);
    const setIsVisualLightMode = (isVisualLightMode: boolean) => dispatch(setIsVisualLightModePreferences(isVisualLightMode))
    const isVisualAutoBranchSwitching = useAppSelector((state) => state.preferences.isVisualAutoBranchSwitching);
    const setIsVisualAutoBranchSwitching = (enabled: boolean) => dispatch(setIsVisualAutoBranchSwitchingPreferences(enabled))
    const isVisualFastExfalso = useAppSelector((state) => state.preferences.isVisualFastExfalso);
    const setIsVisualFastExfalso = (enabled: boolean) => dispatch(setIsVisualFastExfalsoPreferences(enabled))

    const automaticallyAdjustLayout = () => {
        const {width} = getWindowDimensions()
        setMobile(width < AUTO_SWITCH_THRESHOLD)
    }

    React.useEffect(()=>{
        if (layout === "auto"){
          void automaticallyAdjustLayout()
          window.addEventListener('resize', automaticallyAdjustLayout)

          return () => window.removeEventListener('resize', automaticallyAdjustLayout)
        } else {
          setMobile(layout === "mobile")
        }
    }, [layout])

    return {
        mobile,
        layout,
        isSavePreferences,
        language,
        isSuggestionsMobileMode,
        isVisualLightMode,
        isVisualAutoBranchSwitching,
        isVisualFastExfalso,
        setLayout,
        setIsSavePreferences,
        setLanguage,
        setIsSuggestionsMobileMode,
        setIsVisualLightMode,
        setIsVisualAutoBranchSwitching,
        setIsVisualFastExfalso,
    }
}

export default UsePreferences;
