import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { closeModal } from '../slices/uiSlice';
import { X } from 'lucide-react';

export default function Modal({ children, title, width = 'max-w-lg' }) {
  const dispatch = useDispatch();
  const { modalOpen } = useSelector((state) => state.ui);

  if (!modalOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => dispatch(closeModal())}
      />

      {/* Modal content */}
      <div className={`relative ${width} w-full mx-4 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={() => dispatch(closeModal())}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
