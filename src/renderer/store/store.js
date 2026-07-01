import { configureStore } from '@reduxjs/toolkit';
import scenarioReducer from '../slices/scenarioSlice';
import executionReducer from '../slices/executionSlice';
import browserReducer from '../slices/browserSlice';
import uiReducer from '../slices/uiSlice';
import proxyReducer from '../slices/proxySlice';
import browserProfileReducer from '../slices/browserProfileSlice';
import settingsReducer from '../slices/settingsSlice';
import taskReducer from '../slices/taskSlice';

export const store = configureStore({
  reducer: {
    scenarios: scenarioReducer,
    executions: executionReducer,
    browser: browserReducer,
    ui: uiReducer,
    proxies: proxyReducer,
    browserProfiles: browserProfileReducer,
    settings: settingsReducer,
    tasks: taskReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});
