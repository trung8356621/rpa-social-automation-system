import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchBrowserProfiles = createAsyncThunk(
  'browserProfiles/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      return await window.electronAPI.getBrowserProfiles();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const scanBrowserProfiles = createAsyncThunk(
  'browserProfiles/scan',
  async (_, { rejectWithValue }) => {
    try {
      return await window.electronAPI.scanBrowserProfiles();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const openBrowserProfile = createAsyncThunk(
  'browserProfiles/open',
  async (profileId, { rejectWithValue }) => {
    try {
      return await window.electronAPI.openBrowserProfile(profileId);
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const saveBrowserProfile = createAsyncThunk(
  'browserProfiles/save',
  async (profile, { rejectWithValue, dispatch }) => {
    try {
      const saved = await window.electronAPI.saveBrowserProfile(profile);
      dispatch(fetchBrowserProfiles());
      return saved;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const deleteBrowserProfile = createAsyncThunk(
  'browserProfiles/delete',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.deleteBrowserProfile(id);
      dispatch(fetchBrowserProfiles());
      return id;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const browserProfileSlice = createSlice({
  name: 'browserProfiles',
  initialState: {
    items: [],
    loading: false,
    scanning: false,
    opening: false,
    saving: false,
    deleting: false,
    lastScan: null,
    error: null,
  },
  reducers: {
    clearBrowserProfileError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBrowserProfiles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBrowserProfiles.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchBrowserProfiles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(scanBrowserProfiles.pending, (state) => {
        state.scanning = true;
        state.error = null;
      })
      .addCase(scanBrowserProfiles.fulfilled, (state, action) => {
        state.scanning = false;
        state.items = action.payload.items;
        state.lastScan = action.payload;
      })
      .addCase(scanBrowserProfiles.rejected, (state, action) => {
        state.scanning = false;
        state.error = action.payload;
      })
      .addCase(openBrowserProfile.pending, (state) => {
        state.opening = true;
        state.error = null;
      })
      .addCase(openBrowserProfile.fulfilled, (state) => {
        state.opening = false;
      })
      .addCase(openBrowserProfile.rejected, (state, action) => {
        state.opening = false;
        state.error = action.payload;
      })
      .addCase(saveBrowserProfile.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveBrowserProfile.fulfilled, (state) => {
        state.saving = false;
      })
      .addCase(saveBrowserProfile.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      })
      .addCase(deleteBrowserProfile.pending, (state) => {
        state.deleting = true;
        state.error = null;
      })
      .addCase(deleteBrowserProfile.fulfilled, (state) => {
        state.deleting = false;
      })
      .addCase(deleteBrowserProfile.rejected, (state, action) => {
        state.deleting = false;
        state.error = action.payload;
      });
  },
});

export const { clearBrowserProfileError } = browserProfileSlice.actions;
export default browserProfileSlice.reducer;
