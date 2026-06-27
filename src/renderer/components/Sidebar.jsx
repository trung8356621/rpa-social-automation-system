import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentPage } from '../slices/uiSlice';
import {
  Bot,
  Database,
  Globe,
  LayoutDashboard,
  PlayCircle,
  ScrollText,
  Settings,
  Shield,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'proxies', label: 'Proxy', icon: Shield },
  { id: 'browserProfiles', label: 'Browser', icon: Globe },
  { id: 'dataProfiles', label: 'Hồ sơ', icon: Database },
  { id: 'scenarios', label: 'Kịch bản', icon: ScrollText },
  { id: 'executions', label: 'Thực thi', icon: PlayCircle },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

function NavItem({ item, isActive, onClick, onMouseEnter, onMouseLeave, onFocus, onBlur }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      className={`flex h-10 w-full items-center justify-center rounded-lg transition-colors ${
        isActive
          ? 'bg-[#2f80ed] text-white shadow-sm shadow-[#2f80ed]/30'
          : 'text-[#9aa7b7] hover:bg-[#202b3a] hover:text-white'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
    </button>
  );
}

function SidebarTooltip({ tip }) {
  if (!tip) return null;

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[9999] -translate-y-1/2 whitespace-nowrap rounded-md border border-[#3d5068] bg-[#1a2433] px-2.5 py-1.5 text-xs font-medium text-[#e8eef7] shadow-xl shadow-black/50"
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.label}
      <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-[#3d5068] bg-[#1a2433]" />
    </div>,
    document.body,
  );
}

export default function Sidebar() {
  const dispatch = useDispatch();
  const { currentPage } = useSelector((state) => state.ui);
  const [hoverTip, setHoverTip] = useState(null);

  const showTip = (event, label) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverTip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 10,
    });
  };

  const hideTip = () => setHoverTip(null);

  return (
    <>
      <aside className="relative z-30 h-full w-[72px] shrink-0 border-r border-[#2e3b4e] bg-[#151f2d]">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-center border-b border-[#2e3b4e]">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2f80ed] text-white"
              onMouseEnter={(event) => showTip(event, 'RPA Social')}
              onMouseLeave={hideTip}
            >
              <Bot className="h-5 w-5" />
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                isActive={currentPage === item.id}
                onClick={() => dispatch(setCurrentPage(item.id))}
                onMouseEnter={(event) => showTip(event, item.label)}
                onMouseLeave={hideTip}
                onFocus={(event) => showTip(event, item.label)}
                onBlur={hideTip}
              />
            ))}
          </nav>
        </div>
      </aside>
      <SidebarTooltip tip={hoverTip} />
    </>
  );
}
