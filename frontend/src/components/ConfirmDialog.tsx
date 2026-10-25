'use client';

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowRight, Fingerprint, ShieldAlert, X } from 'lucide-react';
import { Portal } from './Portal';

export type ConfirmTone = 'default' | 'financial' | 'danger';

export interface ConfirmDetail {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emphasis?: boolean;
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: React.ReactNode;
  details?: ConfirmDetail[];
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<
  ConfirmTone,
  {
    iconWrap: string;
    icon: React.ReactNode;
    confirm: string;
    warning: string;
  }
> = {
  default: {
    iconWrap: 'bg-stone-100 border-stone-200 text-stone-900',
    icon: <AlertTriangle className="w-5 h-5" />,
    confirm: 'bg-black hover:bg-stone-800 text-white',
    warning: 'border-stone-200 bg-stone-50 text-stone-700',
  },
  financial: {
    iconWrap: 'bg-orange-50 border-orange-200 text-burnt-500',
    icon: <Fingerprint className="w-5 h-5" />,
    confirm: 'bg-black hover:bg-stone-800 text-white',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  danger: {
    iconWrap: 'bg-red-50 border-red-200 text-red-600',
    icon: <ShieldAlert className="w-5 h-5" />,
    confirm: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'border-red-200 bg-red-50 text-red-800',
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  details,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const styles = TONE_STYLES[tone];

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isLoading) onCancel();
        }}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 animate-fade-in"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Close confirmation"
          className="absolute top-4 right-4 p-1.5 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4 pr-6">
          <div
            className={`w-11 h-11 rounded-2xl border flex items-center justify-center flex-shrink-0 ${styles.iconWrap}`}
          >
            {styles.icon}
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3
              id="confirm-dialog-title"
              className="text-lg sm:text-xl font-display font-extrabold tracking-tight text-stone-950"
            >
              {title}
            </h3>
            {description && (
              <p
                id="confirm-dialog-description"
                className="text-xs leading-relaxed text-stone-600"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        {details && details.length > 0 && (
          <dl className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 divide-y divide-stone-200 overflow-hidden">
            {details.map((detail, index) => (
              <div
                key={`${detail.label}-${index}`}
                className="flex items-start justify-between gap-4 px-4 py-2.5"
              >
                <dt className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold pt-0.5 flex-shrink-0">
                  {detail.label}
                </dt>
                <dd
                  className={`text-xs text-right break-all ${
                    detail.mono === false ? 'font-sans' : 'font-mono'
                  } ${detail.emphasis ? 'font-bold text-stone-950' : 'font-semibold text-stone-800'}`}
                >
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {warning && (
          <div
            className={`mt-4 rounded-2xl border px-3.5 py-2.5 text-[11px] leading-relaxed ${styles.warning}`}
          >
            {warning}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-2xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-display font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`w-full py-3.5 px-4 rounded-2xl text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center space-x-2 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${styles.confirm}`}
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Working…</span>
              </>
            ) : (
              <>
                <span>{confirmLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
      </div>
    </Portal>
  );
};
