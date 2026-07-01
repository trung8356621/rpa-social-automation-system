import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronDown, Globe2, Languages } from 'lucide-react';
import { setCurrentView } from '../slices/uiSlice';
import { saveSettings, updateSetting } from '../slices/settingsSlice';
import { SUPPORTED_LANGUAGES, useTranslation } from '../i18n';
import { isMasterBuild } from '../utils/appRole';

const MASTER_VIEW_OPTIONS = [
  { id: 'scenarios', labelKey: 'globalHeader.views.scenarios' },
  { id: 'facebookData', labelKey: 'globalHeader.views.facebookData' },
];

export default function GlobalHeader() {
  const dispatch = useDispatch();
  const { t, language } = useTranslation();
  const { currentView } = useSelector((state) => state.ui);
  const settingsValues = useSelector((state) => state.settings.values);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);

  const viewOptions = MASTER_VIEW_OPTIONS;
  const activeView = viewOptions.find((option) => option.id === currentView) || viewOptions[0];
  const otherLanguage = SUPPORTED_LANGUAGES.find((item) => item.code !== language)
    || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!isMasterBuild) return undefined;

    const handlePointerDown = (event) => {
      if (!viewMenuRef.current?.contains(event.target)) {
        setViewMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  if (!isMasterBuild) {
    return null;
  }

  const handleSelectView = (viewId) => {
    dispatch(setCurrentView(viewId));
    setViewMenuOpen(false);
  };

  const handleToggleLanguage = () => {
    const nextLanguage = otherLanguage.code;
    const nextValues = { ...settingsValues, 'app.language': nextLanguage };
    dispatch(updateSetting({ key: 'app.language', value: nextLanguage }));
    dispatch(saveSettings(nextValues));
  };

  return (
    <header className="z-40 flex h-12 shrink-0 items-center justify-between border-b border-[#2e3b4e] bg-[#151f2d] px-4">
      <div ref={viewMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setViewMenuOpen((open) => !open)}
          className="inline-flex h-8 min-w-[180px] items-center justify-between gap-2 rounded-lg border border-[#3d5068] bg-[#1a2433] px-3 text-sm text-[#e8eef7] hover:border-[#4f6785] hover:bg-[#202b3a]"
          aria-haspopup="listbox"
          aria-expanded={viewMenuOpen}
        >
          <span className="truncate">{t(activeView.labelKey)}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[#9aa7b7] transition-transform ${viewMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {viewMenuOpen && (
          <div
            role="listbox"
            className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[220px] overflow-hidden rounded-lg border border-[#3d5068] bg-[#1a2433] py-1 shadow-xl shadow-black/40"
          >
            {viewOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={currentView === option.id}
                onClick={() => handleSelectView(option.id)}
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                  currentView === option.id
                    ? 'bg-[#2f80ed]/20 text-[#8ec0ff]'
                    : 'text-[#e8eef7] hover:bg-[#202b3a]'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleToggleLanguage}
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#3d5068] bg-[#1a2433] px-3 text-sm text-[#e8eef7] hover:border-[#4f6785] hover:bg-[#202b3a]"
        title={t('globalHeader.switchLanguage')}
      >
        <Languages className="h-4 w-4 text-[#9aa7b7]" />
        <span>{otherLanguage.label}</span>
        <Globe2 className="h-3.5 w-3.5 text-[#6f7d90]" />
      </button>
    </header>
  );
}
