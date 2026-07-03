import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDateToDdMmYyyy, parseDdMmYyyyToDate } from '../../shared/facebookDateFormat.js';
import { useTranslation } from '../i18n';
import './FacebookDatePicker.css';

function NavIcon({ direction }) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return <Icon className="h-4 w-4" aria-hidden />;
}

export default function FacebookDatePicker({
  value = '',
  onChange,
  disabled = false,
  placeholder = 'dd-mm-yyyy',
}) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseDdMmYyyyToDate(value), [value]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = (date) => {
    onChange?.(date ? formatDateToDdMmYyyy(date) : '');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="facebook-date-picker relative">
      <div className="relative">
        <CalendarDays
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa7b7]"
          aria-hidden
        />
        <input
          type="text"
          value={value}
          readOnly
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          className="input-field h-10 w-full cursor-pointer pl-10 pr-10"
        />
        {value && !disabled ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange?.('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[#9aa7b7] hover:bg-[#243041] hover:text-white"
            aria-label={t('facebookData.studio.crawlDateLockClear')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && !disabled ? (
        <div
          className="facebook-date-picker-popover absolute left-0 right-0 z-20 mt-2 rounded-xl border border-[#2e3b4e] bg-[#151f2d] p-3 shadow-2xl"
          onMouseDown={(event) => event.preventDefault()}
        >
          <DayPicker
            mode="single"
            selected={selectedDate || undefined}
            onSelect={handleSelect}
            weekStartsOn={1}
            showOutsideDays
            components={{
              IconLeft: () => <NavIcon direction="left" />,
              IconRight: () => <NavIcon direction="right" />,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
