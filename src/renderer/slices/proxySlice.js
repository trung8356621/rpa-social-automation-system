import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// =============================================================================
// Async Thunks — Giao tiếp với Electron Main Process qua window.electronAPI
// =============================================================================

/**
 * fetchProxies — Lấy danh sách tất cả proxy từ SQLite.
 */
export const fetchProxies = createAsyncThunk(
  'proxies/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const proxies = await window.electronAPI.getProxies();
      return proxies;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * saveProxy — Lưu hoặc cập nhật một proxy.
 * Sau khi lưu thành công, tự động refresh danh sách proxy.
 *
 * @param {Object} proxy - { id?, name, protocol, ip, port, username?, password?, status? }
 */
export const saveProxy = createAsyncThunk(
  'proxies/save',
  async (proxy, { rejectWithValue, dispatch }) => {
    try {
      const result = await window.electronAPI.saveProxy(proxy);
      dispatch(fetchProxies());
      return result;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * deleteProxy — Xóa proxy theo ID.
 */
export const deleteProxy = createAsyncThunk(
  'proxies/delete',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.deleteProxy(id);
      dispatch(fetchProxies());
      return id;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// =============================================================================
// Slice
// =============================================================================

const proxySlice = createSlice({
  name: 'proxies',
  initialState: {
    /** @type {Array<Object>} Danh sách proxy */
    items: [],
    /** @type {boolean} Đang tải dữ liệu */
    loading: false,
    /** @type {string|null} Thông báo lỗi */
    error: null,
  },
  reducers: {
    clearProxyError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // ===== fetchProxies =====
      .addCase(fetchProxies.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProxies.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchProxies.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== saveProxy =====
      .addCase(saveProxy.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveProxy.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(saveProxy.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== deleteProxy =====
      .addCase(deleteProxy.pending, (state) => {
        state.error = null;
      })
      .addCase(deleteProxy.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(deleteProxy.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearProxyError } = proxySlice.actions;
export default proxySlice.reducer;
