/**
 * Status palette — THE single source of truth for status colours app-wide.
 *
 * Both <StatusBadge> (shared) and <Badge> (ui) map onto this one table so the
 * same semantic ("danger", "info", …) ALWAYS renders the same hue everywhere.
 *
 * Design law (Thang): colour carries MEANING, never decoration.
 *   - success  → emerald  (#059669 token `status.success`)
 *   - warning  → amber    (#d97706 token `status.warning`)
 *   - danger   → rose/red (#dc2626 token `status.danger`)
 *   - info     → sky      (#0891b2 token `status.info`)
 *   - neutral  → slate
 *
 * Tailwind utility classes are used (not the raw token hex) because the badges
 * need bg/text/ring/dot ramps that the flat token does not provide; the chosen
 * ramps are the closest Tailwind family to each token and are kept consistent
 * across BOTH badge systems. All variants meet WCAG AA (text-700 on bg-50).
 *
 * WHEN TO USE WHICH:
 *   - <StatusBadge variant=…>  → status with a live/animated DOT (table cells,
 *     pipeline, anything that benefits from the pulse + leading dot). Preferred.
 *   - <Badge variant=…>        → lightweight inline label/tag, NO dot, bordered
 *     pill. Use for counts/tags where a dot would be noise.
 */

export type StatusToken = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusClassSet {
  /** Surface background. */
  bg: string;
  /** Foreground text. */
  text: string;
  /** Inset ring (StatusBadge) — `ring-1 ring-inset ring-*`. */
  ring: string;
  /** Solid border (Badge ui) — `border-*`. */
  border: string;
  /** Leading dot fill. */
  dot: string;
}

/**
 * One palette → consumed by both badge components.
 * danger = rose, info = sky (resolves the old red-vs-rose / cyan-vs-sky drift).
 */
export const STATUS_CLASSES: Record<StatusToken, StatusClassSet> = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-1 ring-inset ring-emerald-200 dark:ring-emerald-900',
    border: 'border-emerald-200 dark:border-emerald-900',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-1 ring-inset ring-amber-200 dark:ring-amber-900',
    border: 'border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
  },
  danger: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    ring: 'ring-1 ring-inset ring-rose-200 dark:ring-rose-900',
    border: 'border-rose-200 dark:border-rose-900',
    dot: 'bg-rose-500',
  },
  info: {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    ring: 'ring-1 ring-inset ring-sky-200 dark:ring-sky-900',
    border: 'border-sky-200 dark:border-sky-900',
    dot: 'bg-sky-500',
  },
  neutral: {
    bg: 'bg-slate-50 dark:bg-slate-800/60',
    text: 'text-slate-700 dark:text-slate-300',
    ring: 'ring-1 ring-inset ring-slate-200 dark:ring-slate-700',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-500',
  },
};
