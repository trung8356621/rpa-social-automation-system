import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentPage } from '../slices/uiSlice';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  History,
  Globe,
  LayoutDashboard,
  PlayCircle,
  ScrollText,
  Settings,
  Shield,
  Users,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'proxies', label: 'Proxy', icon: Shield },
  { id: 'browserProfiles', label: 'Browser', icon: Globe },
  { id: 'profiles', label: 'Tài khoản', icon: Users },
  { id: 'scenarios', label: 'Kịch bản', icon: ScrollText },
  { id: 'executions', label: 'Thực thi', icon: PlayCircle },
  { id: 'history', label: 'Lịch sử', icon: History },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export default function Sidebar() {
  const dispatch = useDispatch();
  const { sidebarOpen, currentPage } = useSelector((state) => state.ui);

  return (
    <aside
      className={`h-full shrink-0 border-r border-[#2e3b4e] bg-[#151f2d] transition-all duration-200 ${
        sidebarOpen ? 'w-64' : 'w-[72px]'
      }`}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-[#2e3b4e] px-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f80ed] text-white">
            <Bot className="h-5 w-5" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">RPA Social</div>
              <div className="truncate text-xs text-[#9aa7b7]">Automation console</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;

            return (
              <button
                key={item.id}
                type="button"
                title={sidebarOpen ? undefined : item.label}
                onClick={() => dispatch(setCurrentPage(item.id))}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#2f80ed] text-white'
                    : 'text-[#9aa7b7] hover:bg-[#202b3a] hover:text-white'
                } ${sidebarOpen ? 'justify-start' : 'justify-center'}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#2e3b4e] p-3">
          <button
            type="button"
            onClick={() => dispatch({ type: 'ui/toggleSidebar' })}
            className="btn-ghost h-10 w-full px-0"
            title={sidebarOpen ? 'Thu gọn' : 'Mở rộng'}
          >
            {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            {sidebarOpen && <span>Thu gọn</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
