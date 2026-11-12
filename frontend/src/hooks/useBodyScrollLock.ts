import { useEffect } from 'react';

let lockCount = 0;
let prevBodyOverflow = '';
let prevHtmlOverflow = '';

/**
 * Locks background page scrolling while `locked` is true.
 * Reference-counted so overlapping modals never prematurely unlock scroll.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return;
    if (lockCount === 0) {
      prevBodyOverflow = document.body.style.overflow;
      prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
      }
    };
  }, [locked]);
}
