import React, { useLayoutEffect, useRef, useState } from 'react';
import { Braces, ChevronDown } from 'lucide-react';
import { formatVariableToken, focusWithCursor, insertTextAtCursor } from '../utils/variables';

export default function VariableInput({
  value,
  onChange,
  variables = [],
  multiline = false,
  className = '',
  placeholder = '',
  inputClassName = 'input-field h-9',
  disabled = false,
}) {
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 224 });

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const width = 224;
    setMenuStyle({
      top: rect.bottom + 4,
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      width,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  const handleInsert = (key) => {
    const token = formatVariableToken(key);
    if (!token) return;

    const nextValue = insertTextAtCursor(inputRef.current, value, token);
    onChange(nextValue);

    const cursor = (inputRef.current?.selectionStart ?? value?.length ?? 0) + token.length;
    focusWithCursor(inputRef.current, cursor);
    setOpen(false);
  };

  const FieldTag = multiline ? 'textarea' : 'input';

  return (
    <div className={`flex min-w-0 items-start gap-1 ${className}`}>
      <FieldTag
        ref={inputRef}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClassName} min-w-0 flex-1`}
        placeholder={placeholder}
        disabled={disabled}
      />
      <div className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled || variables.length === 0}
          onClick={() => {
            if (disabled || variables.length === 0) return;
            setOpen((prev) => !prev);
          }}
          className="inline-flex h-9 items-center gap-0.5 rounded-md border border-[#2f3748] bg-[#1a1f2b] px-2 text-[#9aa7b7] transition hover:bg-[#242b3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          title="Chèn biến"
        >
          <Braces className="h-4 w-4" />
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
        {open && variables.length > 0 && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[80] cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Đóng danh sách biến"
            />
            <div
              className="fixed z-[90] max-h-56 overflow-y-auto rounded-lg border border-[#2f3748] bg-[#151922] py-1 shadow-xl"
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
            >
              {variables.map((variable) => {
                const variableKey = variable.key || variable.name;
                return (
                  <button
                    key={variable.id || variableKey}
                    type="button"
                    onClick={() => handleInsert(variableKey)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[#1f2633]"
                  >
                    <span className="text-xs font-medium text-[#c9d4e8]">{variableKey}</span>
                    <span className="truncate text-[10px] text-[#76849b]">{variable.value || '(trống)'}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
