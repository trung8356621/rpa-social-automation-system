import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSelector } from 'react-redux';
import vi from './locales/vi.js';
import en from './locales/en.js';

const locales = { vi, en };
const I18nContext = createContext(null);

export const SUPPORTED_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
];

export function getNestedValue(object, key) {
  return key.split('.').reduce((current, part) => (
    current && typeof current === 'object' ? current[part] : undefined
  ), object);
}

export function translate(language, key, params = {}) {
  const locale = locales[language] || locales.vi;
  const value = getNestedValue(locale, key);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name) => (
    params[name] !== undefined && params[name] !== null ? String(params[name]) : `{${name}}`
  ));
}

export function I18nProvider({ children }) {
  const language = useSelector((state) => state.settings.values['app.language'] || 'vi');

  const t = useCallback((key, params) => translate(language, key, params), [language]);

  const value = useMemo(() => ({ t, language }), [t, language]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return context;
}

export function useLanguage() {
  return useSelector((state) => state.settings.values['app.language'] || 'vi');
}
