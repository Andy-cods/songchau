'use client';

/**
 * useModalA11y — accessibility primitive for modal/drawer dialogs.
 *
 * Provides:
 *  - Focus trap: Tab cycles forward, Shift+Tab cycles backward within the
 *    container. Focus is moved to the first focusable element on open.
 *  - Restore focus: when the dialog closes, focus is returned to the element
 *    that was active before the dialog opened (typically the trigger button).
 *  - Esc to close: invokes the provided onClose callback. Other shortcuts can
 *    be added by the dialog itself; this hook only handles Esc/Tab.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useModalA11y({ active: true, containerRef: ref, onClose });
 *   return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>...</div>
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface Options {
  /** Hook is a no-op when false (e.g. modal not mounted). */
  active: boolean;
  /** Ref to the modal/drawer container element. */
  containerRef: RefObject<HTMLElement>;
  /** Called when Esc is pressed inside the dialog. */
  onClose: () => void;
}

export function useModalA11y({ active, containerRef, onClose }: Options): void {
  // Restore focus on unmount/close: snapshot the trigger when the dialog
  // mounts, then refocus it when the dialog closes.
  useEffect(() => {
    if (!active) return;
    const trigger = (typeof document !== 'undefined' ? document.activeElement : null) as
      | HTMLElement
      | null;

    // Move focus to first focusable child after mount paints.
    const t = window.setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) first.focus();
      else root.focus();
    }, 30);

    return () => {
      window.clearTimeout(t);
      // Restore focus to the trigger if it's still in the DOM and focusable.
      if (trigger && typeof trigger.focus === 'function' && document.body.contains(trigger)) {
        try {
          trigger.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [active, containerRef]);

  // Tab trap + Esc handler.
  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const root = containerRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !root.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active, containerRef, onClose]);
}

export default useModalA11y;
