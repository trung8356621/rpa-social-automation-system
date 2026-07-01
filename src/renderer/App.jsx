import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateExecutionStatus } from './slices/executionSlice';
import { fetchLocalScenarios } from './slices/scenarioSlice';
import { fetchSettings } from './slices/settingsSlice';
import { setCurrentPage, setCurrentView } from './slices/uiSlice';
import Sidebar from './components/Sidebar';
import GlobalHeader from './components/GlobalHeader';
import Toast from './components/Toast';
import DashboardPage from './pages/DashboardPage';
import ScenariosPage from './pages/ScenariosPage';
import ExecutionsPage from './pages/ExecutionsPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import BrowserProfilesPage from './pages/BrowserProfilesPage';
import DataProfilesPage from './pages/DataProfilesPage';
import FacebookDataPage from './pages/FacebookDataPage';
import FacebookDataSettingsPage from './pages/FacebookDataSettingsPage';
import TasksPage from './pages/TasksPage';
import ProxiesView from './views/ProxiesView';
import {
  isMasterBuild,
  isSlaveBuild,
  SLAVE_ALLOWED_PAGES,
} from './utils/appRole';
import FacebookSidebar from './components/FacebookSidebar';

function useExecutionListener() {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!window.electronAPI?.onExecutionUpdate) {
      console.warn('[App] window.electronAPI chưa sẵn sàng — bỏ qua listener telemetry');
      return;
    }

    const cleanup = window.electronAPI.onExecutionUpdate((status) => {
      dispatch(updateExecutionStatus(status));
    });

    return cleanup;
  }, [dispatch]);
}

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

function useEnforceBuildRoleLayout() {
  const dispatch = useDispatch();
  const { currentPage, currentView } = useSelector((state) => state.ui);

  useEffect(() => {
    if (!isSlaveBuild) return;

    if (currentView !== 'scenarios') {
      dispatch(setCurrentView('scenarios'));
    }

    if (!SLAVE_ALLOWED_PAGES.includes(currentPage)) {
      dispatch(setCurrentPage('scenarios'));
    }
  }, [currentPage, currentView, dispatch]);
}

export default function App() {
  const { currentPage, currentView, facebookDataPage } = useSelector((state) => state.ui);

  useBootstrapApp();
  useExecutionListener();
  useAutoRefreshScenarios();
  useEnforceBuildRoleLayout();

  const showFacebookDataStudio = isMasterBuild && currentView === 'facebookData';
  const showScenarioSidebar = !showFacebookDataStudio;
  const showFacebookSidebar = showFacebookDataStudio;

  const renderPage = () => {
    if (showFacebookDataStudio) {
      if (facebookDataPage === 'settings') {
        return <FacebookDataSettingsPage />;
      }
      return <FacebookDataPage />;
    }

    if (isSlaveBuild && !SLAVE_ALLOWED_PAGES.includes(currentPage)) {
      return <ScenariosPage />;
    }

    switch (currentPage) {
      case 'dashboard':
        return isMasterBuild ? <DashboardPage /> : <ScenariosPage />;
      case 'scenarios':
        return <ScenariosPage />;
      case 'tasks':
        return isMasterBuild ? <TasksPage /> : <ScenariosPage />;
      case 'executions':
        return <ExecutionsPage />;
      case 'history':
        return isMasterBuild ? <HistoryPage /> : <ScenariosPage />;
      case 'proxies':
        return isMasterBuild ? <ProxiesView /> : <ScenariosPage />;
      case 'dataProfiles':
        return isMasterBuild ? <DataProfilesPage /> : <ScenariosPage />;
      case 'browserProfiles':
        return <BrowserProfilesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return isSlaveBuild ? <ScenariosPage /> : <DashboardPage />;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#111827] text-[#eef2f7]">
      <GlobalHeader />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showScenarioSidebar && <Sidebar />}
        {showFacebookSidebar && <FacebookSidebar />}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {renderPage()}
        </main>
      </div>
      <Toast />
    </div>
  );
}
