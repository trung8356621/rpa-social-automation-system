import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

export const launchBrowser = createAsyncThunk(
  'browser/launch',
  async (options, { rejectWithValue }) => {
    try {
      const result = await window.rpaAPI.browser.launch(options);
      if (!result.success) return rejectWithValue(result.error);
      return result.data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const navigateBrowser = createAsyncThunk(
  'browser/navigate',
  async (url, { rejectWithValue }) => {
    try {
      const result = await window.rpaAPI.browser.navigate(url);
      if (!result.success) return rejectWithValue(result.error);
      return result.data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const closeBrowser = createAsyncThunk(
  'browser/close',
  async (_, { rejectWithValue }) => {
    try {
      const result = await window.rpaAPI.browser.close();
      if (!result.success) return rejectWithValue(result.error);
      return result.data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const checkBrowserStatus = createAsyncThunk(
  'browser/status',
  async (_, { rejectWithValue }) => {
    try {
      const result = await window.rpaAPI.browser.status();
      if (!result.success) return rejectWithValue(result.error);
      return result.data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    isRunning: false,
    currentUrl: null,
    currentTitle: null,
    loading: false,
    error: null,
  },
  reducers: {
    clearBrowserError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(launchBrowser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(launchBrowser.fulfilled, (state) => {
        state.loading = false;
        state.isRunning = true;
      })
      .addCase(launchBrowser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(navigateBrowser.fulfilled, (state, action) => {
        state.currentUrl = action.payload.url;
        state.currentTitle = action.payload.title;
      })
      .addCase(navigateBrowser.rejected, (state, action) => {
        state.error = action.payload;
      })

      .addCase(closeBrowser.fulfilled, (state) => {
        state.isRunning = false;
        state.currentUrl = null;
        state.currentTitle = null;
      })

      .addCase(checkBrowserStatus.fulfilled, (state, action) => {
        state.isRunning = action.payload.isRunning;
      });
  },
});

export const { clearBrowserError } = browserSlice.actions;
export default browserSlice.reducer;
