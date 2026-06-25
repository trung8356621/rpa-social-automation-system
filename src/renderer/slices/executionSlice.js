import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// =============================================================================
// Async Thunks
// =============================================================================

/**
 * startLocalCampaign — Gửi lệnh khởi động campaign tới Main Process.
 *
 * Sử dụng window.electronAPI.startLocalCampaign() (one-way, fire-and-forget).
 * Trạng thái thực thi thực tế được cập nhật qua listener onExecutionUpdate
 * trong App component (xem useExecutionListener hook).
 *
 * @param {string} campaignId - UUID của campaign (hoặc scenarioId tạm thời).
 */
export const startLocalCampaign = createAsyncThunk(
  'executions/startLocal',
  async (campaignId, { rejectWithValue }) => {
    try {
      window.electronAPI.startLocalCampaign(campaignId);
      // Trả về ngay lập tức — telemetry sẽ cập nhật realtime
      return { id: campaignId, status: 'triggered' };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// =============================================================================
// Giữ lại các alias tương thích ngược cho code cũ
// =============================================================================
/** @deprecated Dùng startLocalCampaign thay thế */
export const runScenario = startLocalCampaign;

/**
 * fetchAllExecutions — Lấy danh sách tất cả execution từ SQLite.
 *
 * Hiện tại executions được quản lý in-memory qua telemetry.
 * Thunk này trả về items từ store để các component cũ vẫn hoạt động.
 */
export const fetchAllExecutions = createAsyncThunk(
  'executions/fetchAll',
  async (_, { getState, rejectWithValue }) => {
    try {
      // executions hiện được quản lý in-memory qua telemetry,
      // nên trả về state hiện tại. Khi có DB table execution_logs,
      // sẽ thay bằng window.electronAPI gọi SQLite.
      const { executions } = getState();
      return executions.items;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * fetchExecutionDetail — Lấy chi tiết một execution.
 *
 * Hiện tại trả về item từ mảng items trong store.
 */
export const fetchExecutionDetail = createAsyncThunk(
  'executions/fetchDetail',
  async (executionId, { getState, rejectWithValue }) => {
    try {
      const { executions } = getState();
      const found = executions.items.find((item) => item.id === executionId);
      return found || { id: executionId, status: 'unknown' };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// =============================================================================
// Slice
// =============================================================================

const executionSlice = createSlice({
  name: 'executions',
  initialState: {
    /** @type {Array<Object>} Danh sách lịch sử thực thi */
    items: [],
    /** @type {Object|null} Thực thi đang được xem chi tiết */
    currentExecution: null,
    /** @type {boolean} Có tiến trình thực thi đang chạy không */
    isRunning: false,
    /** @type {boolean} Trạng thái đang tải dữ liệu */
    loading: false,
    /** @type {string|null} Thông báo lỗi */
    error: null,

    /**
     * @type {Object|null} Telemetry realtime từ ExecutorService.
     * Được cập nhật mỗi khi Main Process gửi 'rpa:execution-status'.
     * Cấu trúc: { type, executionId, stepIndex, totalSteps, actionType, ... }
     */
    liveStatus: null,
  },
  reducers: {
    /** Xóa thực thi đang chọn */
    clearCurrentExecution: (state) => {
      state.currentExecution = null;
    },
    /** Set trạng thái đang chạy */
    setRunning: (state, action) => {
      state.isRunning = action.payload;
    },
    /**
     * updateExecutionStatus — Cập nhật telemetry realtime từ Main Process.
     *
     * Reducer này được gọi từ listener trong App component khi nhận được
     * event 'rpa:execution-status' từ window.electronAPI.onExecutionUpdate().
     *
     * @param {Object} action.payload - Telemetry payload từ ExecutorService.
     *   Ví dụ: { type: 'step:completed', executionId, stepIndex, ... }
     */
    updateExecutionStatus: (state, action) => {
      const status = action.payload;
      state.liveStatus = status;

      // Cập nhật isRunning dựa trên loại telemetry
      switch (status.type) {
        case 'execution:started':
          state.isRunning = true;
          state.error = null;
          break;

        case 'step:completed':
          // Cập nhật step hiện tại vào currentExecution nếu đang xem
          if (state.currentExecution && state.currentExecution.id === status.executionId) {
            state.currentExecution.completedSteps = status.completedSteps;
          }
          break;

        case 'step:failed':
          // Lỗi step — vẫn đang chạy (không dừng)
          break;

        case 'execution:completed':
          state.isRunning = false;
          // Tự động thêm vào lịch sử
          state.items.unshift({
            id: status.executionId,
            scenario_id: status.scenarioId,
            scenario_name: status.scenarioName,
            status: status.failedSteps > 0 ? 'completed_with_errors' : 'completed',
            total_steps: status.totalSteps,
            completed_steps: status.completedSteps,
            failed_steps: status.failedSteps,
            started_at: new Date(Date.now() - status.durationMs).toISOString(),
            finished_at: new Date().toISOString(),
            duration_ms: status.durationMs,
            errors: status.errors,
          });
          break;

        case 'execution:failed':
          state.isRunning = false;
          state.error = status.error;
          break;

        case 'execution:cancelled':
          state.isRunning = false;
          break;

        default:
          break;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // ===== startLocalCampaign =====
      .addCase(startLocalCampaign.pending, (state) => {
        state.isRunning = true;
        state.error = null;
      })
      .addCase(startLocalCampaign.fulfilled, (state, action) => {
        // Trạng thái thực tế sẽ được cập nhật qua telemetry
        state.currentExecution = action.payload;
      })
      .addCase(startLocalCampaign.rejected, (state, action) => {
        state.isRunning = false;
        state.error = action.payload;
      })

      // ===== fetchAllExecutions =====
      .addCase(fetchAllExecutions.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAllExecutions.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchAllExecutions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== fetchExecutionDetail =====
      .addCase(fetchExecutionDetail.fulfilled, (state, action) => {
        state.currentExecution = action.payload;
      });
  },
});

export const {
  clearCurrentExecution,
  setRunning,
  updateExecutionStatus,
} = executionSlice.actions;
export default executionSlice.reducer;
