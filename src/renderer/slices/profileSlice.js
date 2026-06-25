import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// =============================================================================
// Async Thunks — Giao tiếp với Electron Main Process qua window.electronAPI
// =============================================================================

/**
 * fetchProfiles — Lấy danh sách tất cả profile từ SQLite (kèm proxy_name).
 */
export const fetchProfiles = createAsyncThunk(
  'profiles/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const profiles = await window.electronAPI.getProfiles();
      return profiles;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * saveProfile — Lưu hoặc cập nhật một profile.
 * Sau khi lưu thành công, tự động refresh danh sách profile.
 *
 * @param {Object} profile - { id?, proxy_id?, platform, username, password?, cookie_data?, profile_directory?, status? }
 */
export const saveProfile = createAsyncThunk(
  'profiles/save',
  async (profile, { rejectWithValue, dispatch }) => {
    try {
      const result = await window.electronAPI.saveProfile(profile);
      dispatch(fetchProfiles());
      return result;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * deleteProfile — Xóa profile theo ID.
 */
export const deleteProfile = createAsyncThunk(
  'profiles/delete',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.deleteProfile(id);
      dispatch(fetchProfiles());
      return id;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// =============================================================================
// Slice
// =============================================================================

const profileSlice = createSlice({
  name: 'profiles',
  initialState: {
    /** @type {Array<Object>} Danh sách profile */
    items: [],
    /** @type {boolean} Đang tải dữ liệu */
    loading: false,
    /** @type {string|null} Thông báo lỗi */
    error: null,
  },
  reducers: {
    clearProfileError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // ===== fetchProfiles =====
      .addCase(fetchProfiles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProfiles.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchProfiles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== saveProfile =====
      .addCase(saveProfile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveProfile.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(saveProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== deleteProfile =====
      .addCase(deleteProfile.pending, (state) => {
        state.error = null;
      })
      .addCase(deleteProfile.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(deleteProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearProfileError } = profileSlice.actions;
export default profileSlice.reducer;
