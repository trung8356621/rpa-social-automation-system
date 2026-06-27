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
  async ({ scenarioId, browserProfileId = null, sampleId = null, headless = false }, { rejectWithValue }) => {
    try {
      if (!scenarioId) {
        throw new Error('Thiếu kịch bản cần chạy');
      }
      window.electronAPI.startLocalCampaign({ scenarioId, browserProfileId, sampleId, headless });
      return { id: scenarioId, browserProfileId, sampleId, status: 'triggered' };
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
  async (_, { rejectWithValue }) => {
    try {
      if (!window.electronAPI?.getExecutions) {
        return [];
      }
      return await window.electronAPI.getExecutions(100);
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
      if (window.electronAPI?.getExecution) {
        const detail = await window.electronAPI.getExecution(executionId);
        if (detail) return detail;
      }
      const { executions } = getState();
      const found = executions.items.find((item) => item.id === executionId);
      return found || { id: executionId, status: 'unknown' };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const clearAllExecutions = createAsyncThunk(
  'executions/clearAll',
  async (_, { rejectWithValue }) => {
    try {
      if (!window.electronAPI?.clearExecutions) {
        throw new Error('Không hỗ trợ xóa lịch sử — hãy khởi động lại app');
      }
      return await window.electronAPI.clearExecutions();
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
    /** @type {Array<Object>} Danh sách lịch sử thực thi đã hoàn thành */
    items: [],
    /** @type {Object} Map executionId → live state (cho multitask) */
    runningExecutions: {},
    /** @type {Object|null} Thực thi đang được xem chi tiết */
    currentExecution: null,
    /** @type {boolean} Trạng thái đang tải dữ liệu */
    loading: false,
    /** @type {string|null} Thông báo lỗi gần nhất */
    error: null,
    /** @type {Object|null} Telemetry event cuối cùng (dùng cho toast) */
    liveStatus: null,
  },
  reducers: {
    clearCurrentExecution: (state) => {
      state.currentExecution = null;
    },
    // kept for backward compat
    setRunning: () => {},
    updateExecutionStatus: (state, action) => {
      const status = action.payload;
      state.liveStatus = status;
      const eid = status.executionId;

      switch (status.type) {
        case 'execution:started':
          state.error = null;
          if (eid) {
            state.runningExecutions[eid] = {
              id: eid,
              scenario_id: status.scenarioId,
              scenario_name: status.scenarioName,
              status: 'running',
              total_steps: status.totalSteps || 0,
              completed_steps: 0,
              started_at: status.timestamp || new Date().toISOString(),
            };
          }
          break;

        case 'step:completed':
          if (eid && state.runningExecutions[eid]) {
            state.runningExecutions[eid].completed_steps = status.completedSteps ?? 0;
          }
          if (state.currentExecution?.id === eid) {
            state.currentExecution.completedSteps = status.completedSteps;
          }
          break;

        case 'step:failed':
          break;

        case 'execution:completed': {
          const running = state.runningExecutions[eid];
          if (eid) delete state.runningExecutions[eid];
          state.items.unshift({
            id: eid,
            scenario_id: status.scenarioId,
            scenario_name: status.scenarioName,
            variable_profile_name: running?.variable_profile_name ?? null,
            status: (status.failedSteps ?? 0) > 0 ? 'completed_with_errors' : 'completed',
            total_steps: status.totalSteps,
            completed_steps: status.completedSteps,
            failed_steps: status.failedSteps,
            started_at: running?.started_at || new Date(Date.now() - (status.durationMs || 0)).toISOString(),
            finished_at: new Date().toISOString(),
            duration_ms: status.durationMs,
          });
          break;
        }

        case 'execution:failed': {
          const running = state.runningExecutions[eid];
          if (eid) delete state.runningExecutions[eid];
          state.error = status.error;
          state.items.unshift({
            id: eid || `failed-${Date.now()}`,
            scenario_id: status.scenarioId,
            scenario_name: status.scenarioName || 'N/A',
            variable_profile_name: running?.variable_profile_name ?? null,
            status: 'failed',
            total_steps: status.totalSteps || 0,
            completed_steps: status.completedSteps ?? Math.max(0, (status.stepIndex || 1) - 1),
            failed_steps: 1,
            failed_step_index: status.stepIndex,
            started_at: running?.started_at || status.startedAt || new Date().toISOString(),
            finished_at: new Date().toISOString(),
            error_message: status.error,
          });
          break;
        }

        case 'execution:cancelled':
          if (eid) delete state.runningExecutions[eid];
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
      .addCase(startLocalCampaign.fulfilled, (state) => {
        // Trạng thái thực tế sẽ được cập nhật qua telemetry
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
      })

      // ===== clearAllExecutions =====
      .addCase(clearAllExecutions.pending, (state) => {
        state.loading = true;
      })
      .addCase(clearAllExecutions.fulfilled, (state) => {
        state.loading = false;
        state.items = [];
        state.currentExecution = null;
        state.error = null;
        // Keep runningExecutions intact — they are live tasks still in progress
      })
      .addCase(clearAllExecutions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const {
  clearCurrentExecution,
  setRunning,
  updateExecutionStatus,
} = executionSlice.actions;
export default executionSlice.reducer;
