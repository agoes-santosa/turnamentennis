// bump-cache-version.mjs — bumps the shared `?v=N` cache-busting query
// string used on every internal <link>/<script> tag and JS module import.
//
// Why this exists: this app has no build step and no hashed filenames (see
// README.md), and GitHub Pages -- unlike the Netlify setup this project
// originally targeted -- sends no explicit no-cache header of its own. Left
// alone, a returning visitor's browser can keep running a stale copy of the
// JS/CSS indefinitely after a deploy. `?v=N` forces a fresh fetch by
// changing the URL itself, which every browser treats as a different
// resource regardless of any cache header.
//
// Run this once, from the repo root, as the last step before committing any
// change to index.html or a js/*.js file:
//   node bump-cache-version.mjs
//
// It reads whatever `?v=N` is currently highest across the tracked files,
// writes back `?v=N+1` everywhere it appears, and prints the change. All
// files must move to the same new number together -- a mismatched version
// on just one file's import would make the browser load two separate
// instances of that module (each with its own top-level state) instead of
// sharing one, which is a real correctness bug, not just a style nit.

import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'index.html',
  'js/app.js',
  'js/store.js',
  'js/ui.js',
  'js/seed-data.js',
];

const texts = files.map((f) => readFileSync(f, 'utf8'));
const current = Math.max(
  0,
  ...texts.flatMap((t) => [...t.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]))),
);
const next = current + 1;

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  writeFileSync(f, text.replaceAll(/\?v=\d+/g, `?v=${next}`));
}

// eslint-disable-next-line no-console
console.log(`Cache-busting version bumped: ${current} -> ${next} across ${files.length} files.`);
