'use client';

/**
 * sheet-kit.tsx — the shared spreadsheet design system for the
 * "Tạo hồ sơ giao hàng" 6-tab wizard.
 *
 * Goal (Thang's #1 acceptance test): each tab must *look like the actual Excel
 * sheet it produces*. This file is the single set of primitives every sheet tab
 * (Packing List / Cam kết / List Detail / Label / Tổng hợp) consumes, so they
 * all read identically — real Excel gridlines (border-collapse + per-cell slate
 * borders), slate-50/100 header fill, white editable cells with a brand focus
 * ring, slate read-only label cells, right-aligned mono numerics.
 *
 * Design law (from components/cockpit/tokens.ts — do NOT re-derive colors):
 *   ONE brand indigo (#4f46e5) for focus/active ONLY, sparingly + slate ramp +
 *   functional emerald/amber/sky/rose. NO gradients / orbs / rainbow tiles.
 *
 * EditCell / NumCell wrap the EXISTING CellInput / CellNumber (keep the
 * decimal-typing fix) inside a <td> that owns the focus ring; the inner input
 * stays borderless so the *cell*, not the input, reads like a spreadsheet cell.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CellInput, CellNumber } from './wizard-steps';

// ─── The canonical class strings (§1.3 of the design spec, verbatim) ─────────

export const SHEET = {
  // The "paper" — one sheet
  frame:      'bg-white ring-1 ring-slate-200 rounded-lg overflow-hidden',
  scrollWrap: 'overflow-x-auto',                       // wrap <table> for wide sheets
  table:      'w-full border-collapse text-[12px]',     // border-collapse = real grid lines

  // Title + meta (merged-cell mimics)
  title:      'text-center font-display font-bold text-[15px] tracking-[0.04em] ' +
              'uppercase text-slate-800 py-2.5 border-b border-slate-200 bg-slate-50',
  metaLine:   'text-[12px] font-bold text-slate-800',   // "VENDOR NAME: AMA BẮC NINH JSC"
  metaWrap:   'px-3 py-2 flex flex-col gap-0.5 border-b border-slate-200 bg-white',

  // Header row
  headRow:    'bg-slate-100',
  th:         'border border-slate-200 px-2 py-2 text-[11px] font-semibold uppercase ' +
              'tracking-[0.06em] text-slate-600 text-left whitespace-nowrap',
  thNum:      'border border-slate-200 px-2 py-2 text-[11px] font-semibold uppercase ' +
              'tracking-[0.06em] text-slate-600 text-right whitespace-nowrap',
  thCtr:      'border border-slate-200 px-2 py-2 text-[11px] font-semibold uppercase ' +
              'tracking-[0.06em] text-slate-600 text-center whitespace-nowrap',

  // Body cells (every cell gets thin slate grid borders → spreadsheet look)
  labelCell:  'border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px] ' +
              'font-semibold text-slate-600 align-top',
  readCell:   'border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700',
  readNum:    'border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 ' +
              'text-right font-mono tabular-nums',
  readCode:   'border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800 font-mono',

  // Editable cells (cell owns the ring; inner input is borderless)
  editCell:   'border border-slate-200 bg-white p-0 ' +
              'ring-1 ring-inset ring-transparent hover:ring-brand-200 ' +
              'focus-within:ring-2 focus-within:ring-brand-500 transition-[box-shadow]',
  editDirty:  'bg-amber-50/60',                         // append when value != default

  // TOTAL / footer
  totalRow:   'bg-slate-50 border-t-2 border-slate-300',
  totalLabel: 'border border-slate-200 px-2 py-2 text-right text-[11px] font-mono ' +
              'uppercase tracking-[0.06em] text-slate-500',
  totalNum:   'border border-slate-200 px-2 py-2 text-right font-mono font-bold ' +
              'text-slate-800 tabular-nums',
  totalNumBrand: 'border border-slate-200 px-2 py-2 text-right font-mono font-bold ' +
              'text-brand-700 tabular-nums',                // for the "primary" total (Ship/Qty)

  // Print-label card (tab ⑤)
  labelBlock: 'ring-1 ring-slate-300 rounded-md bg-white overflow-hidden',
  labelBlockHd:'bg-slate-100 px-3 py-1.5 text-[11px] font-mono uppercase ' +
              'tracking-[0.08em] text-slate-600 border-b border-slate-200',
} as const;

type Align = 'left' | 'right' | 'center';
const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

// ─── evalCellFormula — safe spreadsheet-style formula evaluator ───────────────
//
// Lets a numeric cell accept either a plain number ("12.5") OR a tiny arithmetic
// expression ("2*3", "(4+1)/2"). NO eval / new Function — a pure shunting-yard
// parser walks a whitelisted token stream so nothing but +-*/() and numbers can
// ever execute.
//
//   ''               → null   (blank)
//   "12.5"           → 12.5   (plain number)
//   "2*3"            → 6      (formula, rounded to 3 decimals)
//   "1/0", "bad"     → null   (invalid → caller reverts/treats as blank)
export function evalCellFormula(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (s === '') return null; // blank

  // Plain number — fast path, no parser needed.
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }

  // Formula path: only whitelisted chars AND at least one operator.
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return null;
  if (!/[+\-*/]/.test(s)) return null;

  const result = evalArith(s);
  if (result == null || !Number.isFinite(result)) return null;
  return Math.round(result * 1000) / 1000;
}

/** Pure shunting-yard arithmetic evaluator. Supports + - * / parentheses,
 *  unary minus and decimals. Returns null on any malformed input. */
function evalArith(expr: string): number | null {
  type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' };
  const tokens: Tok[] = [];

  // ── Tokenize ──
  let i = 0;
  let prevType: 'start' | 'num' | 'op' | 'lp' | 'rp' = 'start';
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let j = i;
      let dots = 0;
      while (j < expr.length && ((expr[j] >= '0' && expr[j] <= '9') || expr[j] === '.')) {
        if (expr[j] === '.') dots++;
        j++;
      }
      if (dots > 1) return null;
      const num = parseFloat(expr.slice(i, j));
      if (!Number.isFinite(num)) return null;
      tokens.push({ t: 'num', v: num });
      prevType = 'num';
      i = j;
      continue;
    }
    if (ch === '(') { tokens.push({ t: 'lp' }); prevType = 'lp'; i++; continue; }
    if (ch === ')') { tokens.push({ t: 'rp' }); prevType = 'rp'; i++; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      // Unary minus/plus: at start, after an operator, or after '('.
      const unary = prevType === 'start' || prevType === 'op' || prevType === 'lp';
      if (unary && (ch === '-' || ch === '+')) {
        tokens.push({ t: 'op', v: ch === '-' ? 'u-' : 'u+' });
      } else {
        tokens.push({ t: 'op', v: ch });
      }
      prevType = 'op';
      i++;
      continue;
    }
    return null; // any other char is invalid
  }
  if (!tokens.length) return null;

  // ── Shunting-yard → RPN ──
  const prec: Record<string, number> = { 'u-': 4, 'u+': 4, '*': 3, '/': 3, '+': 2, '-': 2 };
  const rightAssoc = (op: string) => op === 'u-' || op === 'u+';
  const output: Tok[] = [];
  const ops: Tok[] = [];
  for (const tk of tokens) {
    if (tk.t === 'num') { output.push(tk); continue; }
    if (tk.t === 'op') {
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t !== 'op') break;
        if (prec[top.v] > prec[tk.v] || (prec[top.v] === prec[tk.v] && !rightAssoc(tk.v))) {
          output.push(ops.pop()!);
        } else break;
      }
      ops.push(tk);
      continue;
    }
    if (tk.t === 'lp') { ops.push(tk); continue; }
    if (tk.t === 'rp') {
      let found = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.t === 'lp') { found = true; break; }
        output.push(top);
      }
      if (!found) return null; // mismatched parens
      continue;
    }
  }
  while (ops.length) {
    const top = ops.pop()!;
    if (top.t === 'lp' || top.t === 'rp') return null; // mismatched parens
    output.push(top);
  }

  // ── Evaluate RPN ──
  const stack: number[] = [];
  for (const tk of output) {
    if (tk.t === 'num') { stack.push(tk.v); continue; }
    if (tk.t === 'op') {
      if (tk.v === 'u-' || tk.v === 'u+') {
        if (stack.length < 1) return null;
        const a = stack.pop()!;
        stack.push(tk.v === 'u-' ? -a : a);
        continue;
      }
      if (stack.length < 2) return null;
      const b = stack.pop()!;
      const a = stack.pop()!;
      let r: number;
      switch (tk.v) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': r = a / b; break; // div-by-zero → Infinity/NaN, rejected below
        default: return null;
      }
      stack.push(r);
      continue;
    }
    return null;
  }
  if (stack.length !== 1) return null;
  const out = stack[0];
  return Number.isFinite(out) ? out : null;
}

// ─── SheetFrame — one bordered "paper" sheet ─────────────────────────────────

export function SheetFrame({
  scroll, minW, children, className,
}: {
  scroll?: boolean;
  minW?: string;          // e.g. 'min-w-[1560px]' for the wide Packing List
  children: ReactNode;
  className?: string;
}) {
  const inner = scroll ? (
    <div className={SHEET.scrollWrap}>
      <div className={cn(minW)}>{children}</div>
    </div>
  ) : (
    children
  );
  return <div className={cn(SHEET.frame, className)}>{inner}</div>;
}

// ─── SheetTitle — centered uppercase merged-title row ────────────────────────

export function SheetTitle({ children }: { children: ReactNode }) {
  return <div className={SHEET.title}>{children}</div>;
}

// ─── SheetMeta — top-left bold "VENDOR NAME: …" lines ────────────────────────

export function SheetMeta({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className={SHEET.metaWrap}>
      {rows.map((r, i) => (
        <div key={i} className={SHEET.metaLine}>
          {r.label}: <span className="text-slate-700">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── SheetHint — thin flat sky info bar above a sheet ────────────────────────

export function SheetHint({
  icon, title, children, tone = 'sky',
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  tone?: 'sky' | 'slate';
}) {
  const toneClass = tone === 'sky'
    ? 'bg-sky-50 ring-sky-200 text-sky-800'
    : 'bg-slate-50 ring-slate-200 text-slate-700';
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg ring-1 ring-inset px-3 py-2.5 text-xs', toneClass)}>
      {icon && <span className="mt-0.5 flex-shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="font-semibold mb-0.5">{title}</p>
        {children && <div className="leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

// ─── HeaderRow / Th / SpanTh ─────────────────────────────────────────────────

export function HeaderRow({ children }: { children: ReactNode }) {
  return <tr className={SHEET.headRow}>{children}</tr>;
}

export function Th({
  align = 'left', w, span, rowSpan, title, sticky, children, className,
}: {
  align?: Align;
  w?: string;
  span?: number;
  rowSpan?: number;
  title?: string;
  sticky?: string;        // e.g. 'left-0 z-20' for frozen identity columns
  children: ReactNode;
  className?: string;
}) {
  const base = align === 'right' ? SHEET.thNum : align === 'center' ? SHEET.thCtr : SHEET.th;
  return (
    <th
      colSpan={span}
      rowSpan={rowSpan}
      title={title}
      className={cn(base, w, sticky && cn('sticky bg-slate-100', sticky), className)}
    >
      {children}
    </th>
  );
}

/** A header cell that spans N sub-columns with a centered caption (e.g.
 *  "DIMENSION (MM)" over L | W | H). The caller renders the sub-header <tr>
 *  with the N child <Th> cells right after the row that holds this SpanTh. */
export function SpanTh({ caption, colSpan }: { caption: ReactNode; colSpan: number }) {
  return (
    <th colSpan={colSpan} className={cn(SHEET.thCtr)}>
      {caption}
    </th>
  );
}

// ─── LabelCell / ReadCell ────────────────────────────────────────────────────

export function LabelCell({
  children, w, className, align = 'left', colSpan, rowSpan,
}: {
  children: ReactNode;
  w?: string;
  className?: string;
  align?: Align;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={cn(SHEET.labelCell, alignClass[align], w, className)}>
      {children}
    </td>
  );
}

export function ReadCell({
  children, mono, code, num, align, w, className, colSpan, rowSpan, sticky,
}: {
  children?: ReactNode;
  mono?: boolean;
  code?: boolean;
  num?: boolean;
  align?: Align;
  w?: string;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  sticky?: string;        // e.g. 'left-0 z-10' for frozen identity columns
}) {
  const base = code ? SHEET.readCode : num ? SHEET.readNum : SHEET.readCell;
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={cn(
        base,
        mono && !code && !num && 'font-mono',
        align && alignClass[align],
        w,
        sticky && cn('sticky bg-white', sticky),
        className,
      )}
    >
      {children}
    </td>
  );
}

// ─── EditCell — editable text cell (wraps CellInput) ─────────────────────────
// The <td> owns the focus ring; CellInput stays borderless. `dirty` tints amber.

export function EditCell({
  value, onChange, placeholder, dirty, align = 'left', inputMode, w, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dirty?: boolean;
  align?: Align;
  inputMode?: 'text' | 'decimal' | 'numeric';
  w?: string;
  className?: string;
}) {
  return (
    <td className={cn(SHEET.editCell, dirty && SHEET.editDirty, w, className)}>
      <CellInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        inputMode={inputMode}
        className={cn('px-2 py-1.5 hover:border-transparent focus:ring-0 rounded-none', alignClass[align])}
      />
    </td>
  );
}

// ─── NumCell — editable numeric cell (wraps CellNumber) ──────────────────────

export function NumCell({
  value, onChange, min, max, step, placeholder, dirty, tone, w, className,
  formula, allowBlank,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: string;
  placeholder?: string;
  dirty?: boolean;
  tone?: 'brand' | 'amber';
  w?: string;
  className?: string;
  /** Accept arithmetic formulas (e.g. "2*3"), evaluated on blur via evalCellFormula. */
  formula?: boolean;
  /** Permit an empty cell to emit null (blank) instead of coercing to 0. */
  allowBlank?: boolean;
}) {
  const toneText = tone === 'brand' ? 'text-brand-700 font-semibold'
    : tone === 'amber' ? 'text-amber-700 font-semibold'
    : '';
  return (
    <td className={cn(SHEET.editCell, dirty && SHEET.editDirty, w, className)}>
      <CellNumber
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        formula={formula}
        allowBlank={allowBlank}
        className={cn('px-2 py-1.5 text-right tabular-nums hover:border-transparent focus:ring-0 rounded-none', toneText)}
      />
    </td>
  );
}

// ─── TotalRow — <tfoot> summary row ──────────────────────────────────────────

export function TotalRow({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr className={SHEET.totalRow}>{children}</tr>
    </tfoot>
  );
}

// ─── LabelBlock — one print-label "tem" card (tab ⑤) ─────────────────────────

export function LabelBlock({
  index, rows,
}: {
  index: number;
  rows: { label: string; value: ReactNode; mono?: boolean; emphasize?: boolean; tone?: 'brand' }[];
}) {
  return (
    <div className={SHEET.labelBlock}>
      <div className={SHEET.labelBlockHd}>LABEL · TEM #{index}</div>
      <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 p-4 text-[12px] font-mono">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <div className="text-slate-500">{r.label}</div>
            <div
              className={cn(
                'text-slate-800 break-words',
                r.tone === 'brand' ? 'text-brand-700 font-bold' : r.emphasize ? 'font-semibold' : '',
              )}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
