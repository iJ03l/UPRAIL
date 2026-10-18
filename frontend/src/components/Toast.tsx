'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, React.ComponentType<{ className?: string }>> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

const DURATION = 2400;
const MAX_VISIBLE = 3;

/**
 * Tiny bottom-anchored toast stack for copy confirmations and action outcomes.
 * Deliberately dependency-free — one provider, one `useToast()` hook. The stack
 * caps at MAX_VISIBLE so a burst of copies never buries the UI.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++idRef.current;
      setItems((list) => [...list, { id, message, tone }].slice(-MAX_VISIBLE));
      timers.current.set(id, setTimeout(() => dismiss(id), DURATION));
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed z-[200] bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 flex flex-col items-center sm:items-end gap-2 pointer-events-none">
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={`pointer-events-auto flex items-center space-x-2 pl-3 pr-1.5 py-2.5 rounded-2xl border shadow-lg bg-white/95 backdrop-blur-sm animate-fade-in ${
                t.tone === 'error' ? 'border-red-200 text-red-800' : 'border-stone-200 text-stone-800'
              }`}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${
                  t.tone === 'error'
                    ? 'text-red-500'
                    : t.tone === 'success'
                      ? 'text-emerald-500'
                      : 'text-stone-400'
                }`}
              />
              <span className="text-xs font-mono font-bold max-w-[16rem]">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
