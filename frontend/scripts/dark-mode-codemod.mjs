#!/usr/bin/env node
/**
 * Dark mode codemod — auto-add `dark:` variants to hardcoded Tailwind classes.
 *
 * Phase 2 of plans/dark-mode/PROPOSAL.md.
 *
 * Usage:
 *   node scripts/dark-mode-codemod.mjs --dry-run        # preview, no writes
 *   node scripts/dark-mode-codemod.mjs                  # apply
 *   node scripts/dark-mode-codemod.mjs --path src/app/  # restrict scope
 *
 * Strategy:
 *   - Walk all .tsx/.ts files under src/ (skip node_modules, .next, dist).
 *   - Find class strings inside className="...", className={`...`}, cn('...'),
 *     clsx('...'), and twMerge('...').
 *   - For each whitespace-separated token that matches our LIGHT→DARK map,
 *     append the corresponding dark: variant ONLY IF that variant doesn't
 *     already exist in the same string.
 *   - Idempotent. Safe to re-run.
 *
 * Limitations (left to manual fix-up):
 *   - Conditional classes from runtime variables (e.g. `bg-${color}-500`)
 *   - Recharts/Chart.js stroke/fill props (require theme prop, not classes)
 *   - inline style={{ color: '...' }}
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Color mappings ───────────────────────────────────────────────

const LIGHT_TO_DARK = {
  // Backgrounds
  'bg-white':         'dark:bg-slate-900',
  'bg-slate-50':      'dark:bg-slate-900',
  'bg-slate-100':     'dark:bg-slate-800',
  'bg-slate-200':     'dark:bg-slate-700',
  'bg-slate-300':     'dark:bg-slate-600',
  'bg-gray-50':       'dark:bg-slate-900',
  'bg-gray-100':      'dark:bg-slate-800',

  // Text
  'text-slate-900':   'dark:text-slate-50',
  'text-slate-800':   'dark:text-slate-100',
  'text-slate-700':   'dark:text-slate-200',
  'text-slate-600':   'dark:text-slate-300',
  'text-slate-500':   'dark:text-slate-400',
  'text-slate-400':   'dark:text-slate-500',
  'text-slate-300':   'dark:text-slate-600',
  'text-gray-900':    'dark:text-slate-50',
  'text-gray-800':    'dark:text-slate-100',
  'text-gray-700':    'dark:text-slate-200',
  'text-gray-600':    'dark:text-slate-300',
  'text-gray-500':    'dark:text-slate-400',
  'text-gray-400':    'dark:text-slate-500',

  // Borders
  'border-slate-100': 'dark:border-slate-800',
  'border-slate-200': 'dark:border-slate-700',
  'border-slate-300': 'dark:border-slate-600',
  'border-gray-100':  'dark:border-slate-800',
  'border-gray-200':  'dark:border-slate-700',

  // Status badges (subtle, only when both bg + text appear together)
  'bg-emerald-50':    'dark:bg-emerald-900/30',
  'bg-emerald-100':   'dark:bg-emerald-900/40',
  'text-emerald-700': 'dark:text-emerald-300',
  'text-emerald-600': 'dark:text-emerald-400',
  'border-emerald-200': 'dark:border-emerald-700',

  'bg-rose-50':       'dark:bg-rose-900/30',
  'bg-rose-100':      'dark:bg-rose-900/40',
  'text-rose-700':    'dark:text-rose-300',
  'text-rose-600':    'dark:text-rose-400',
  'border-rose-200':  'dark:border-rose-700',

  'bg-red-50':        'dark:bg-red-900/30',
  'text-red-700':     'dark:text-red-300',
  'text-red-600':     'dark:text-red-400',
  'border-red-200':   'dark:border-red-700',

  'bg-amber-50':      'dark:bg-amber-900/30',
  'bg-amber-100':     'dark:bg-amber-900/40',
  'text-amber-700':   'dark:text-amber-300',
  'text-amber-600':   'dark:text-amber-400',
  'border-amber-200': 'dark:border-amber-700',

  'bg-blue-50':       'dark:bg-blue-900/30',
  'bg-blue-100':      'dark:bg-blue-900/40',
  'text-blue-700':    'dark:text-blue-300',
  'text-blue-600':    'dark:text-blue-400',
  'border-blue-200':  'dark:border-blue-700',

  'bg-purple-50':     'dark:bg-purple-900/30',
  'text-purple-700':  'dark:text-purple-300',
  'text-purple-600':  'dark:text-purple-400',

  'bg-green-50':      'dark:bg-green-900/30',
  'bg-green-100':     'dark:bg-green-900/40',
  'text-green-700':   'dark:text-green-300',
  'text-green-600':   'dark:text-green-400',
};

// Compile a single regex matching any of our LIGHT class names as a
// whole word (so `bg-slate-100` does not match `bg-slate-1000`).
const ALL_LIGHT_KEYS = Object.keys(LIGHT_TO_DARK)
  .sort((a, b) => b.length - a.length); // longest first

// ─── Walk + transform ─────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const pathIdx = args.indexOf('--path');
const ROOT = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  pathIdx >= 0 ? args[pathIdx + 1] : 'src',
);

const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.git',
]);
const SKIP_FILES = new Set([
  'theme-provider.tsx', 'theme-toggle.tsx',
]);

function walk(dir, fn) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name), fn);
    } else if (ent.isFile()) {
      if (SKIP_FILES.has(ent.name)) continue;
      const ext = extname(ent.name);
      if (ext === '.tsx' || ext === '.ts' || ext === '.jsx') {
        fn(join(dir, ent.name));
      }
    }
  }
}

/**
 * Add dark variants to a single class string (the contents between quotes
 * inside className="..." or backticks). Idempotent.
 */
function transformClassString(input) {
  // Tokenize: keep order, dedupe. Tokens are whitespace-separated.
  // We DO NOT touch tokens that are interpolations like ${var}.
  const tokens = input.split(/\s+/);
  const present = new Set(tokens);
  const additions = [];

  for (const token of tokens) {
    // Strip leading variant prefixes (hover:, focus:, sm:, etc.) before lookup
    const colonIdx = token.lastIndexOf(':');
    const base = colonIdx >= 0 ? token.slice(colonIdx + 1) : token;
    const prefix = colonIdx >= 0 ? token.slice(0, colonIdx + 1) : '';

    const darkClass = LIGHT_TO_DARK[base];
    if (!darkClass) continue;
    // darkClass is e.g. "dark:bg-slate-900"; if there's a prefix like
    // "hover:" we need "hover:dark:..." which Tailwind does NOT support
    // — skip prefixed variants (manual review).
    if (prefix) continue;

    if (!present.has(darkClass)) {
      additions.push(darkClass);
      present.add(darkClass);
    }
  }

  if (additions.length === 0) return input;
  // Append additions; keep original order intact.
  return tokens.concat(additions).join(' ');
}

// Match className="..." OR className={`...`} OR className={'...'} bodies,
// AND any string literal inside cn(...), clsx(...), twMerge(...).
const PATTERNS = [
  // className="..."
  /className\s*=\s*"([^"]*)"/g,
  // className={`...`}  (no interpolation; if ${} present, we still process the
  // static parts but conservatively skip interpolated tokens)
  /className\s*=\s*\{`([^`]*)`\}/g,
  // className={'...'} or className={"..."}
  /className\s*=\s*\{\s*['"]([^'"]*)['"]\s*\}/g,
  // cn('...'), clsx('...'), twMerge('...') — capture string literal arg
  /(?:cn|clsx|twMerge)\(\s*['"`]([^'"`]*)['"`]/g,
];

function transformFile(content) {
  let out = content;
  let changedCount = 0;

  for (const re of PATTERNS) {
    out = out.replace(re, (full, body) => {
      // If the body contains template literal interpolation ${}, only
      // transform tokens we can reason about safely (none for now — skip).
      if (body.includes('${')) return full;
      const transformed = transformClassString(body);
      if (transformed === body) return full;
      changedCount++;
      return full.replace(body, transformed);
    });
  }

  return { out, changedCount };
}

// ─── Main ─────────────────────────────────────────────────────────

let totalFiles = 0;
let touchedFiles = 0;
let totalReplacements = 0;

walk(ROOT, (filePath) => {
  totalFiles++;
  const before = readFileSync(filePath, 'utf8');
  const { out, changedCount } = transformFile(before);
  if (out !== before) {
    touchedFiles++;
    totalReplacements += changedCount;
    if (!DRY_RUN) {
      writeFileSync(filePath, out, 'utf8');
    }
    const rel = filePath.replace(ROOT, '');
    console.log(`${DRY_RUN ? '[dry]' : '[edit]'} ${rel}  (${changedCount} className updates)`);
  }
});

console.log('');
console.log(`Scanned:    ${totalFiles} files`);
console.log(`Touched:    ${touchedFiles} files`);
console.log(`Updates:    ${totalReplacements} className strings`);
console.log(`Mode:       ${DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE'}`);
if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
