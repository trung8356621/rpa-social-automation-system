import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const defaultSettings = {
  'app.language': 'vi',
  'browser.headless': false,
  'browser.viewportWidth': 1280,
  'browser.viewportHeight': 800,
  'browser.userDataDir': '',
  'automation.defaultWaitBefore': 1000,
  'automation.defaultWaitAfter': 500,
  'automation.maxRetries': 3,
  'automation.screenshotOnError': true,
  'execution.browserCloseDelayMs': 5000,
  'facebook.crawlGroupScenarioId': '',
  'facebook.crawlCommentScenarioId': '',
};

export const fetchSettings = createAsyncThunk(
  'settings/fetch',
  async (_, { rejectWithValue }) => {
    try {
      const settings = await window.electronAPI.getSettings();
      return { ...defaultSettings, ...settings };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const saveSettings = createAsyncThunk(
  'settings/save',
  async (settings, { rejectWithValue }) => {
    try {
      const saved = await window.electronAPI.saveSettings(settings);
      return { ...defaultSettings, ...saved };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const settingsSlice = createSlice({
  name: 'settings',
  initialState: {
    values: { ...defaultSettings },
    loading: false,
    saving: false,
    saved: false,
    error: null,
  },
  reducers: {
    updateSetting: (state, action) => {
      const { key, value } = action.payload;
      state.values[key] = value;
      state.saved = false;
    },
    clearSettingsSaved: (state) => {
      state.saved = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.values = action.payload;
      })
      .addCase(fetchSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(saveSettings.pending, (state) => {
        state.saving = true;
        state.saved = false;
        state.error = null;
      })
      .addCase(saveSettings.fulfilled, (state, action) => {
        state.saving = false;
        state.saved = true;
        state.values = action.payload;
      })
      .addCase(saveSettings.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      });
  },
});

export const { updateSetting, clearSettingsSaved } = settingsSlice.actions;
export default settingsSlice.reducer;
