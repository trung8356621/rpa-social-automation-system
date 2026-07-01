import React from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '../i18n';

export default function RequestCatchingSearchBox({ value, onChange, placeholder }) {
  const { t } = useTranslation();

  return (
    <div className="relative shrink-0 border-b border-[#2a3144] px-2 py-1.5">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f7d92]" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || t('scenarioEditor.requestCatching.searchPlaceholder')}
        className="h-7 w-full rounded-md border border-[#2a3144] bg-[#0d0f13] pl-8 pr-2 text-[11px] text-[#d7e3f4] placeholder:text-[#6f7d92] focus:border-[#3d6fd4] focus:outline-none"
      />
    </div>
  );
}

export function matchesSearchQuery(text, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return String(text || '').toLowerCase().includes(needle);
}
