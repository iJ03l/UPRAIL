import React, { useState, useEffect } from 'react';
import { AtSign, CheckCircle2, User, X } from 'lucide-react';

interface HandleInputProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const FREQUENT_HANDLES = ['illia', 'mert', 'alex'];

export const HandleInput: React.FC<HandleInputProps> = ({
  value,
  onChange,
  disabled = false,
  placeholder = 'username',
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [debouncedValue, setDebouncedValue] = useState(value);

  // Clean raw handle input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Strip leading @ and any whitespace
    const cleaned = raw.replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
    onChange(cleaned);
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, 250);
    return () => clearTimeout(handler);
  }, [value]);

  const isValidHandle = debouncedValue.length >= 2;

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
          Recipient
        </label>
        {isValidHandle && (
          <span className="text-xs text-stone-900 flex items-center space-x-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Valid 𝕏 handle</span>
          </span>
        )}
      </div>

      <div
        className={`relative flex items-center rounded-2xl bg-stone-50 border transition-all duration-200 ${
          isFocused
            ? 'border-stone-900 ring-1 ring-stone-900 bg-white'
            : 'border-stone-200 hover:border-stone-300'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {/* At Prefix */}
        <div className="pl-4 pr-1 text-stone-700 font-mono font-bold flex items-center pointer-events-none select-none">
          <AtSign className="w-5 h-5" />
        </div>

        {/* Input */}
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-transparent py-3.5 pr-10 text-stone-900 placeholder-stone-400 font-medium text-base focus:outline-none"
        />

        {/* Clear or Valid Indicator */}
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="absolute right-3.5 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="absolute right-3.5 text-stone-400 pointer-events-none">
            <User className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Quick suggest tags with illia, mert, alex */}
      {!value && (
        <div className="flex items-center space-x-2 pt-1 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-stone-400 pr-1">Try:</span>
          {FREQUENT_HANDLES.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange(h)}
              className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-black text-xs font-mono transition-colors border border-stone-200"
            >
              @{h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
