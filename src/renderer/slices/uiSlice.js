import { createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    sidebarOpen: true,
    currentPage: 'dashboard',
    modalOpen: null, // null | 'createScenario' | 'confirmDelete' | 'executionDetail'
    modalData: null,
    toast: null, // { type: 'success'|'error'|'info', message: string }
    searchQuery: '',
    selectedScenarioId: null,
  },
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setCurrentPage: (state, action) => {
      state.currentPage = action.payload;
    },
    openModal: (state, action) => {
      state.modalOpen = action.payload.type;
      state.modalData = action.payload.data || null;
    },
    closeModal: (state) => {
      state.modalOpen = null;
      state.modalData = null;
    },
    showToast: (state, action) => {
      state.toast = action.payload;
    },
    clearToast: (state) => {
      state.toast = null;
    },
    setSearchQuery: (state, action) => {
      state.searchQuery = action.payload;
    },
    setSelectedScenarioId: (state, action) => {
      state.selectedScenarioId = action.payload;
    },
  },
});

export const {
  toggleSidebar,
  setCurrentPage,
  openModal,
  closeModal,
  showToast,
  clearToast,
  setSearchQuery,
  setSelectedScenarioId,
} = uiSlice.actions;

export default uiSlice.reducer;
