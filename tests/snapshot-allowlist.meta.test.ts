// Snapshot-allowlist meta-test: guards that KOVO_SEMANTIC_ATTRS in
// packages/test/src/integration/semantic-snapshot.ts stays in lockstep with
// the `isGeneratedOnlyRenderAttribute` predicate in
// packages/compiler/src/emit/server.ts (SPEC §5.2/§4.8).
//
// The comment in semantic-snapshot.ts explicitly requires lockstep between the
// two (line 10): "The set of kept generated attributes is intentionally aligned
// with the compiler's render-equivalence allowlist". This test enforces that
// every kovo-prefixed and data-bind* attribute in the snapshot allowlist is
// either recognised by the compiler predicate or consciously documented as an
// exception in KNOWN_EXCEPTIONS below.
//
// If you add a new kovo-* or data-bind* attr to KOVO_SEMANTIC_ATTRS and this
// test fails, you must either:
//   a) add the attr to isGeneratedOnlyRenderAttribute in
//      packages/compiler/src/emit/server.ts (preferred), OR
//   b) add it to KNOWN_EXCEPTIONS below with a justification comment.

import { describe, expect, it } from 'vitest';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import { KOVO_SEMANTIC_ATTRS } from '../packages/test/src/integration/semantic-snapshot.js';

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Read the compiler predicate source so we can do lockstep assertions
// without needing to export the private function.
const SERVER_TS = path.join(
  REPO_ROOT,
  'packages/compiler/src/emit/server.ts',
);

function readPredicateBody(): string {
  const source = fs.readFileSync(SERVER_TS, 'utf8');
  const start = source.indexOf('function isGeneratedOnlyRenderAttribute(');
  if (start === -1) throw new Error('isGeneratedOnlyRenderAttribute not found in server.ts');
  // Grab from the function start to the closing brace (function is non-nested).
  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error('Could not locate closing brace of isGeneratedOnlyRenderAttribute');
}

/**
 * Attributes in KOVO_SEMANTIC_ATTRS that are NOT in isGeneratedOnlyRenderAttribute
 * by design, with a documented justification.
 *
 * DO NOT ADD entries here silently — each entry must explain why the attribute
 * is intentionally absent from the compiler predicate.
 */
const KNOWN_EXCEPTIONS = new Map<string, string>([
  [
    'kovo-query',
    'Runtime custom element context attribute, not a compiler stamp; ' +
      'the predicate governs render-equivalence only.',
  ],
  [
    'data-bind-list',
    'GAP (plans/bugs-and-testing.md D2 finding): compiler-authored list-binding stamp ' +
      '(packages/compiler/src/lower/structural-jsx.ts + inline-derives.ts) that is ' +
      'missing from isGeneratedOnlyRenderAttribute. ' +
      'TODO: add data-bind-list to that predicate to close the drift.',
  ],
]);

describe('snapshot-allowlist ↔ isGeneratedOnlyRenderAttribute lockstep', () => {
  it('KOVO_SEMANTIC_ATTRS exports a non-empty readonly array', () => {
    expect(Array.isArray(KOVO_SEMANTIC_ATTRS)).toBe(true);
    expect(KOVO_SEMANTIC_ATTRS.length).toBeGreaterThan(0);
  });

  it('isGeneratedOnlyRenderAttribute exists in packages/compiler/src/emit/server.ts', () => {
    const body = readPredicateBody();
    expect(body.length).toBeGreaterThan(0);
    // Spot-check: must recognise a core generated stamp.
    expect(body).toContain("'kovo-c'");
  });

  it('every kovo-* attribute in KOVO_SEMANTIC_ATTRS is in isGeneratedOnlyRenderAttribute or KNOWN_EXCEPTIONS', () => {
    const predicateBody = readPredicateBody();
    const kovoAttrs = KOVO_SEMANTIC_ATTRS.filter((a) => a.startsWith('kovo-'));
    const unexplained: string[] = [];

    for (const attr of kovoAttrs) {
      if (KNOWN_EXCEPTIONS.has(attr)) continue;
      if (!predicateBody.includes(`'${attr}'`)) {
        unexplained.push(attr);
      }
    }

    expect(
      unexplained,
      `These kovo-* attributes are in KOVO_SEMANTIC_ATTRS but not in ` +
        `isGeneratedOnlyRenderAttribute and not in KNOWN_EXCEPTIONS — add them ` +
        `to the predicate or to KNOWN_EXCEPTIONS with a justification: ` +
        unexplained.join(', '),
    ).toEqual([]);
  });

  it('every data-bind* attribute in KOVO_SEMANTIC_ATTRS is in isGeneratedOnlyRenderAttribute or KNOWN_EXCEPTIONS', () => {
    const predicateBody = readPredicateBody();
    const dataBindAttrs = KOVO_SEMANTIC_ATTRS.filter((a) => a.startsWith('data-bind'));
    const unexplained: string[] = [];

    for (const attr of dataBindAttrs) {
      if (KNOWN_EXCEPTIONS.has(attr)) continue;
      // Covered by exact match OR by prefix wildcard in the predicate.
      const coveredByExact = predicateBody.includes(`'${attr}'`);
      const coveredByPrefix =
        attr.startsWith('data-bind:') && predicateBody.includes("name.startsWith('data-bind:')");
      if (!coveredByExact && !coveredByPrefix) {
        unexplained.push(attr);
      }
    }

    expect(
      unexplained,
      `These data-bind* attributes are in KOVO_SEMANTIC_ATTRS but not in ` +
        `isGeneratedOnlyRenderAttribute and not in KNOWN_EXCEPTIONS: ` +
        unexplained.join(', '),
    ).toEqual([]);
  });
});
