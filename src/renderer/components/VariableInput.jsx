import React, { useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);

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
          type="button"
          disabled={disabled || variables.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[#2f3748] bg-[#1a1f2b] text-[#9aa7b7] transition hover:bg-[#242b3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          title="Chèn biến"
        >
          <Braces className="h-4 w-4" />
          <ChevronDown className="ml-0.5 h-3 w-3 opacity-70" />
        </button>
        {open && variables.length > 0 && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Đóng danh sách biến"
            />
            <div className="absolute right-0 top-full z-50 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-[#2f3748] bg-[#151922] py-1 shadow-xl">
              {variables.map((variable) => (
                <button
                  key={variable.id || variable.key}
                  type="button"
                  onClick={() => handleInsert(variable.key)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[#1f2633]"
                >
                  <span className="text-xs font-medium text-[#c9d4e8]">{variable.key}</span>
                  <span className="truncate text-[10px] text-[#76849b]">{variable.value || '(trống)'}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
