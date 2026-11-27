#!/usr/bin/env node
// Verifies WCAG 2.1 contrast ratios for the design-token pairs we actually use.
// Reads values from packages/ui/src/tokens.css so the check never drifts from the tokens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../packages/ui/src/tokens.css', import.meta.url)),
  'utf8',
);
const vars = Object.fromEntries(
  [...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
);

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// [foreground, background, minimum, usage]
const AA = 4.5; // normal text
const UI = 3; // large text / UI components / focus indicators
const pairs = [
  ['color-primary-fg', 'color-primary', AA, 'Primary button label'],
  ['color-primary-fg', 'color-primary-hover', AA, 'Primary button hover'],
  ['color-primary-fg', 'color-primary-active', AA, 'Primary button pressed'],
  ['color-primary', 'color-bg', AA, 'Orange link / text on white'],
  ['color-primary', 'color-surface-muted', AA, 'Orange link on light grey'],
  ['color-primary-subtle-fg', 'color-primary-subtle', AA, 'Tinted badge / secondary button'],
  ['color-primary-subtle-fg', 'color-primary-subtle-hover', AA, 'Secondary button hover'],
  ['color-text', 'color-bg', AA, 'Body text'],
  ['color-text', 'color-surface-sunken', AA, 'Body text on sunken surface'],
  ['color-text-muted', 'color-bg', AA, 'Secondary text'],
  ['color-text-muted', 'color-surface-muted', AA, 'Secondary text on light grey'],
  ['color-text-subtle', 'color-bg', AA, 'Captions / placeholders'],
  ['color-success', 'color-success-subtle', AA, 'Success badge'],
  ['color-warning', 'color-warning-subtle', AA, 'Warning badge'],
  ['color-danger', 'color-danger-subtle', AA, 'Danger badge'],
  ['color-info', 'color-info-subtle', AA, 'Info badge'],
  ['color-danger', 'color-bg', AA, 'Error text'],
  ['color-focus', 'color-bg', UI, 'Focus ring on white'],
  ['color-input-border', 'color-bg', UI, 'Form control border on white'],
  ['color-input-border', 'color-surface-muted', UI, 'Form control border on light grey'],
  ['color-on-accent', 'color-accent', AA, 'Wheel label on accent orange'],
  ['color-on-accent', 'brand-200', AA, 'Wheel label on light orange segment'],
  ['color-text', 'brand-100', AA, 'Wheel label on pale orange segment'],
  ['color-primary-fg', 'brand-700', AA, 'White wheel label on deep orange segment'],
];

let failed = 0;
console.log('WCAG contrast check (tokens.css)\n');
for (const [fg, bg, min, usage] of pairs) {
  const a = vars[fg];
  const b = vars[bg];
  if (!a || !b) {
    console.log(`  MISSING  ${fg} / ${bg}`);
    failed++;
    continue;
  }
  const r = ratio(a, b);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${a} on ${b}  — ${usage}`,
  );
}
console.log(failed ? `\n${failed} pair(s) failed.` : '\nAll pairs pass.');
process.exit(failed ? 1 : 0);
