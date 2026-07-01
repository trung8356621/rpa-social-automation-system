import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchTasks = createAsyncThunk(
  'tasks/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      return await window.electronAPI.getTasks();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const fetchTaskDetails = createAsyncThunk(
  'tasks/fetchDetails',
  async (id, { rejectWithValue }) => {
    try {
      return await window.electronAPI.getTask(id);
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const saveTask = createAsyncThunk(
  'tasks/save',
  async (task, { rejectWithValue, dispatch }) => {
    try {
      const saved = await window.electronAPI.saveTask(task);
      dispatch(fetchTasks());
      return saved;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

export const deleteTask = createAsyncThunk(
  'tasks/delete',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      await window.electronAPI.deleteTask(id);
      dispatch(fetchTasks());
      return id;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
);

const taskSlice = createSlice({
  name: 'tasks',
  initialState: {
    items: [],
    currentTask: null,
    loading: false,
    error: null,
  },
  reducers: {
    setCurrentTask: (state, action) => {
      state.currentTask = action.payload;
    },
    clearCurrentTask: (state) => {
      state.currentTask = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchTaskDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTaskDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.currentTask = action.payload;
      })
      .addCase(fetchTaskDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(saveTask.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveTask.fulfilled, (state, action) => {
        state.loading = false;
        state.currentTask = action.payload;
        const index = state.items.findIndex((item) => item.id === action.payload.id);
        if (index >= 0) {
          state.items[index] = action.payload;
        } else {
          state.items.unshift(action.payload);
        }
      })
      .addCase(saveTask.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(deleteTask.fulfilled, (state, action) => {
        state.items = state.items.filter((item) => item.id !== action.payload);
        if (state.currentTask?.id === action.payload) {
          state.currentTask = null;
        }
      });
  },
});

export const { setCurrentTask, clearCurrentTask } = taskSlice.actions;
export default taskSlice.reducer;
