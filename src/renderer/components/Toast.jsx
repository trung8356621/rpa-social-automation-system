import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearToast } from '../slices/uiSlice';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const colors = {
  success: 'bg-[#142f2a] border-[#236b5b] text-[#b7f4df]',
  error: 'bg-[#351d24] border-[#7f3442] text-[#ffc4cc]',
  info: 'bg-[#172b45] border-[#315d93] text-[#c9defa]',
};

export default function Toast() {
  const dispatch = useDispatch();
  const toast = useSelector((state) => state.ui.toast);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        dispatch(clearToast());
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast, dispatch]);

  if (!toast) return null;

  const Icon = icons[toast.type] || Info;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-right">
      <div className={`flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 shadow-2xl ${colors[toast.type] || colors.info}`}>
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm font-medium leading-5">{toast.message}</span>
        <button
          onClick={() => dispatch(clearToast())}
          className="ml-2 rounded p-1 hover:bg-black/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
