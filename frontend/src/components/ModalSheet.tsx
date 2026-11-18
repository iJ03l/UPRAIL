'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Portal } from './Portal';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export interface ModalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  canClose?: boolean;
  zIndexClass?: string;
  maxWidthClass?: string;
  panelClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  showCloseButton?: boolean;
  closeLabel?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared accessible modal container:
 * - Mobile (<640px): bottom sheet with grab handle, swipe-to-dismiss, and safe-area inset.
 * - Desktop (>=640px): centered dialog card.
 * - Handles body scroll lock, Escape, backdrop tap-out, focus trapping, and focus restoration.
 */
export const ModalSheet: React.FC<ModalSheetProps> = ({
  isOpen,
  onClose,
  canClose = true,
  zIndexClass = 'z-[110]',
  maxWidthClass = 'sm:max-w-md',
  panelClassName = '',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  showCloseButton = false,
  closeLabel = 'Close dialog',
  initialFocusRef,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const touchStartY = useRef<number | null>(null);
  const allowSwipe = useRef(false);
  const [dragY, setDragY] = useState(0);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) {
      setDragY(0);
      return;
    }

    const previousActive = document.activeElement as HTMLElement | null;

    const rafId = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ||
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ||
        dialogRef.current;
      target?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (canClose) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) {
          event.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown);
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
    };
  }, [isOpen, canClose, initialFocusRef]);

  if (!isOpen) return null;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!canClose || event.touches.length !== 1) return;
    const panel = dialogRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const touchY = event.touches[0].clientY;
    // Allow drag from the grab handle / header zone or anywhere while scrolled to top
    if (panel.scrollTop <= 0 || touchY - rect.top <= 64) {
      touchStartY.current = touchY;
      allowSwipe.current = true;
    } else {
      allowSwipe.current = false;
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!allowSwipe.current || touchStartY.current === null || !canClose) return;
    const panel = dialogRef.current;
    if (panel && panel.scrollTop > 0) {
      allowSwipe.current = false;
      setDragY(0);
      return;
    }
    const delta = event.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setDragY(delta);
    } else {
      setDragY(0);
    }
  };

  const handleTouchEnd = () => {
    if (!allowSwipe.current) return;
    allowSwipe.current = false;
    touchStartY.current = null;
    if (dragY > 72 && canClose) {
      setDragY(0);
      onClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <Portal>
      <div
        className={`fixed inset-0 ${zIndexClass} flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-950/60`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && canClose) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
          className={`relative w-full ${maxWidthClass} rounded-t-3xl sm:rounded-3xl bg-white border border-stone-200 shadow-2xl max-h-[92dvh] overflow-y-auto overscroll-contain pt-3 sm:pt-0 focus:outline-none ${dragY === 0 ? 'transition-transform duration-200' : ''} ${panelClassName}`.trim()}
        >
          {/* Mobile grab handle */}
          <div
            aria-hidden="true"
            className="sm:hidden mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-[var(--line-strong)] flex-shrink-0"
          />

          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              disabled={!canClose}
              aria-label={closeLabel}
              className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X weight="bold" className="w-4 h-4" />
            </button>
          )}

          {children}

          {/* Safe-area bottom spacer on mobile so home indicator never overlaps actions */}
          <div aria-hidden="true" className="sm:hidden h-[env(safe-area-inset-bottom)] flex-shrink-0" />
        </div>
      </div>
    </Portal>
  );
};
