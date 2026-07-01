import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchLocalScenarios = createAsyncThunk(
  'scenarios/fetchLocal',
  async (_, { rejectWithValue }) => {
    try {
      return await window.electronAPI.getScenarios();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const fetchScenarioDetails = createAsyncThunk(
  'scenarios/fetchDetails',
  async (id, { rejectWithValue }) => {
    try {
      return await window.electronAPI.getScenarioDetails(id);
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const saveLocalScenario = createAsyncThunk(
  'scenarios/saveLocal',
  async ({ scenario, steps = [] }, { rejectWithValue, dispatch }) => {
    try {
      const saved = await window.electronAPI.saveScenario(scenario, steps);
      dispatch(fetchLocalScenarios());
      return saved;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const createScenario = createAsyncThunk(
  'scenarios/create',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const saved = await window.electronAPI.saveScenario(
        {
          name: payload.name || 'Kịch bản mới',
          description: payload.description || '',
          platform: payload.platform || 'facebook',
          target_url: payload.target_url || null,
          recorded_width: payload.recorded_width || 1280,
          recorded_height: payload.recorded_height || 720,
          device_pixel_ratio: payload.device_pixel_ratio || 1,
        },
        payload.steps || [],
      );
      dispatch(fetchLocalScenarios());
      return saved;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const updateScenario = saveLocalScenario;

export const saveScenarioSteps = createAsyncThunk(
  'scenarios/saveSteps',
  async ({ scenario, steps = [] }, { rejectWithValue, dispatch }) => {
    try {
      const saved = await window.electronAPI.saveScenario(scenario, steps);
      dispatch(fetchLocalScenarios());
      return saved;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const deleteScenario = createAsyncThunk(
  'scenarios/delete',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.deleteScenario(id);
      dispatch(fetchLocalScenarios());
      return id;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const setScenarioPinned = createAsyncThunk(
  'scenarios/setPinned',
  async ({ id, isPinned }, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.setScenarioPinned(id, isPinned);
      dispatch(fetchLocalScenarios());
      return { id, is_pinned: isPinned ? 1 : 0 };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const fetchScenarios = fetchLocalScenarios;
export const fetchScenarioById = fetchScenarioDetails;

const scenarioSlice = createSlice({
  name: 'scenarios',
  initialState: {
    items: [],
    currentScenario: null,
    loading: false,
    error: null,
  },
  reducers: {
    clearCurrentScenario: (state) => {
      state.currentScenario = null;
    },
    setCurrentScenario: (state, action) => {
      state.currentScenario = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLocalScenarios.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLocalScenarios.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchLocalScenarios.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchScenarioDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchScenarioDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.currentScenario = action.payload;
      })
      .addCase(fetchScenarioDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(saveLocalScenario.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveLocalScenario.fulfilled, (state, action) => {
        state.loading = false;
        state.currentScenario = action.payload;
        const index = state.items.findIndex((item) => item.id === action.payload.id);
        if (index >= 0) {
          state.items[index] = action.payload;
        } else {
          state.items.unshift(action.payload);
        }
      })
      .addCase(saveLocalScenario.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createScenario.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createScenario.fulfilled, (state, action) => {
        state.loading = false;
        state.currentScenario = action.payload;
        state.items.unshift(action.payload);
      })
      .addCase(createScenario.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(deleteScenario.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteScenario.fulfilled, (state, action) => {
        state.loading = false;
        state.items = state.items.filter((item) => item.id !== action.payload);
        if (state.currentScenario?.id === action.payload) {
          state.currentScenario = null;
        }
      })
      .addCase(deleteScenario.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(setScenarioPinned.fulfilled, (state, action) => {
        const scenario = state.items.find((item) => item.id === action.payload.id);
        if (scenario) {
          scenario.is_pinned = action.payload.is_pinned;
        }
        if (state.currentScenario?.id === action.payload.id) {
          state.currentScenario.is_pinned = action.payload.is_pinned;
        }
      });
  },
});

export const { clearCurrentScenario, setCurrentScenario, clearError } = scenarioSlice.actions;
export default scenarioSlice.reducer;
