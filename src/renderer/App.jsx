import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateExecutionStatus } from './slices/executionSlice';
import { fetchLocalScenarios } from './slices/scenarioSlice';
import { fetchSettings } from './slices/settingsSlice';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import DashboardPage from './pages/DashboardPage';
import ScenariosPage from './pages/ScenariosPage';
import ExecutionsPage from './pages/ExecutionsPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import BrowserProfilesPage from './pages/BrowserProfilesPage';
import DataProfilesPage from './pages/DataProfilesPage';
import TasksPage from './pages/TasksPage';
import ProxiesView from './views/ProxiesView';

/**
 * useExecutionListener — Custom hook lắng nghe telemetry thực thi từ Main Process.
 *
 * Đăng ký listener qua window.electronAPI.onExecutionUpdate() (xem preload.cjs).
 * Mỗi khi ExecutorService gửi cập nhật (step started/completed/failed, ...),
 * dispatch action updateExecutionStatus để Redux store cập nhật realtime.
 *
 * Listener tự động dọn dẹp khi component unmount (tránh memory leak).
 */
function useExecutionListener() {
  const dispatch = useDispatch();

  useEffect(() => {
    // Kiểm tra window.electronAPI tồn tại trước khi đăng ký listener
    // (preload.cjs chạy sau khi BrowserWindow được tạo, nên API luôn sẵn sàng
    // khi React mount. Kiểm tra này chỉ để phòng tránh lỗi runtime.)
    if (!window.electronAPI?.onExecutionUpdate) {
      console.warn('[App] window.electronAPI chưa sẵn sàng — bỏ qua listener telemetry');
      return;
    }

    // onExecutionUpdate trả về hàm cleanup để remove listener
    const cleanup = window.electronAPI.onExecutionUpdate((status) => {
      dispatch(updateExecutionStatus(status));
    });

    return cleanup;
  }, [dispatch]);
}

/**
 * useAutoRefreshScenarios — Tự động tải danh sách kịch bản khi app khởi động.
 */
function useAutoRefreshScenarios() {
  const dispatch = useDispatch();

  useEffect(() => {
    if (window.electronAPI?.getScenarios) {
      dispatch(fetchLocalScenarios());
    } else {
      console.warn('[App] window.electronAPI chưa sẵn sàng — bỏ qua fetch scenarios');
    }
  }, [dispatch]);
}

function useBootstrapApp() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);
}

export default function App() {
  const { currentPage } = useSelector((state) => state.ui);

  // Kích hoạt các hooks
  useBootstrapApp();
  useExecutionListener();
  useAutoRefreshScenarios();

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'scenarios':
        return <ScenariosPage />;
      case 'tasks':
        return <TasksPage />;
      case 'executions':
        return <ExecutionsPage />;
      case 'history':
        return <HistoryPage />;
      case 'proxies':
        return <ProxiesView />;
      case 'dataProfiles':
        return <DataProfilesPage />;
      case 'browserProfiles':
        return <BrowserProfilesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#111827] text-[#eef2f7]">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {renderPage()}
      </main>
      <Toast />
    </div>
  );
}
