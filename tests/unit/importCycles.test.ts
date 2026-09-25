// No module in src/ may take part in an import cycle.
//
// This exists because a cycle between AppHeader and CommandPalette shipped to
// production and broke the app at render:
//
//   ReferenceError: Cannot access 'ue' before initialization
//       at AppHeader-BdUH63AU.js
//
// and every guard the project had said it was fine. `npm run build` succeeded,
// `tsc` was clean, ESLint was clean, and 671 tests passed — because a cycle is
// only fatal at EVALUATION time, and only when the bundler happens to order
// the two modules so that one reads the other's `const` before it exists. Dev
// ordered them the lucky way. The production chunking did not.
//
// So the check has to be structural rather than behavioural: look at what
// imports what, and refuse a loop. A cycle that happens to work today is a
// deployment away from not working, and the failure lands in the browser
// rather than in CI.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const SRC = resolve(__dirname, '..', '..', 'src');
const EXTENSIONS = ['.ts', '.tsx'];

/** Every .ts/.tsx file under src/, as absolute paths. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e)) && !entry.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The module specifiers a file imports, both static and `export … from`.
 *
 * Type-only imports are EXCLUDED: `import type` is erased before the bundle
 * exists, so it cannot participate in an evaluation-order failure, and
 * forbidding it would outlaw a pattern this codebase uses correctly all over.
 */
function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)(\s+type)?\s[^;]*?from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    specifiers.push(match[2]);
  }
  // `import './side-effect'` has no `from` clause.
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves a specifier to a file under src/, or null when it leaves src/. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // A package. Not ours, and never part of a cycle we can fix.
    return null;
  }

  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  for (const ext of EXTENSIONS) {
    const candidate = join(base, `index${ext}`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

describe('the import graph', () => {
  it('has no cycles', () => {
    const files = sourceFiles(SRC);
    const graph = new Map<string, string[]>();

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const edges = importsOf(source)
        .map((specifier) => resolveSpecifier(file, specifier))
        .filter((target): target is string => target !== null && target !== file);
      graph.set(file, edges);
    }

    // Depth-first search, colouring nodes: white (unseen), grey (on the
    // current path), black (finished). An edge to a grey node is a cycle, and
    // the path from that node back to itself is the cycle to report — naming
    // it matters, because "there is a cycle somewhere in 400 files" is not
    // something anybody can act on.
    const state = new Map<string, 'grey' | 'black'>();
    const path: string[] = [];
    const cycles: string[] = [];

    const visit = (file: string): void => {
      const seen = state.get(file);
      if (seen === 'black') return;
      if (seen === 'grey') {
        const from = path.indexOf(file);
        const loop = [...path.slice(from), file]
          .map((f) => relative(SRC, f).replace(/\\/g, '/'))
          .join('  →  ');
        cycles.push(loop);
        return;
      }

      state.set(file, 'grey');
      path.push(file);
      for (const next of graph.get(file) ?? []) visit(next);
      path.pop();
      state.set(file, 'black');
    };

    for (const file of files) visit(file);

    // Deduplicated: one cycle is reachable from every file that leads into it,
    // and reporting it forty times buries the other ones.
    const unique = [...new Set(cycles)];
    expect(
      unique,
      unique.length === 0
        ? ''
        : `Import cycles found. A cycle is only fatal when the bundler evaluates ` +
          `the modules in the unlucky order, which is why this passes build and ` +
          `tests and breaks in the browser:\n\n${unique.join('\n\n')}\n\n` +
          `Move the shared values into a module that imports neither side — ` +
          `src/components/command/commandEvents.ts is the worked example.`,
    ).toEqual([]);
  });
});
