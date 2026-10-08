import React, { useState, useEffect } from 'react';
import { AtSign, CheckCircle2, User, X } from 'lucide-react';

interface HandleInputProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const FREQUENT_HANDLES = ['alice', 'bob_builder', 'vitalik', 'satoshi'];

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
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Recipient
        </label>
        {isValidHandle && (
          <span className="text-xs text-brand-400 flex items-center space-x-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Valid X handle</span>
          </span>
        )}
      </div>

      <div
        className={`relative flex items-center rounded-xl bg-dark-surface border transition-all duration-200 ${
          isFocused
            ? 'border-brand-500 shadow-glow-brand ring-1 ring-brand-500/20'
            : 'border-dark-border hover:border-slate-700'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {/* At Prefix */}
        <div className="pl-4 pr-1 text-brand-400 font-mono font-bold flex items-center pointer-events-none select-none">
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
          className="w-full bg-transparent py-3.5 pr-10 text-white placeholder-slate-500 font-medium text-base focus:outline-none"
        />

        {/* Clear or Valid Indicator */}
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="absolute right-3.5 p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="absolute right-3.5 text-slate-600 pointer-events-none">
            <User className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Quick suggest tags */}
      {!value && (
        <div className="flex items-center space-x-1.5 pt-1 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-slate-500 pr-1">Suggestions:</span>
          {FREQUENT_HANDLES.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange(h)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors flex items-center space-x-0.5"
            >
              <span>@{h}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
