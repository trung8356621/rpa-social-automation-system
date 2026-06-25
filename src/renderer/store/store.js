import { configureStore } from '@reduxjs/toolkit';
import scenarioReducer from '../slices/scenarioSlice';
import executionReducer from '../slices/executionSlice';
import browserReducer from '../slices/browserSlice';
import uiReducer from '../slices/uiSlice';
import proxyReducer from '../slices/proxySlice';
import profileReducer from '../slices/profileSlice';
import browserProfileReducer from '../slices/browserProfileSlice';
import settingsReducer from '../slices/settingsSlice';

export const store = configureStore({
  reducer: {
    scenarios: scenarioReducer,
    executions: executionReducer,
    browser: browserReducer,
    ui: uiReducer,
    proxies: proxyReducer,
    profiles: profileReducer,
    browserProfiles: browserProfileReducer,
    settings: settingsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});
