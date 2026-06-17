import { diagnosticDefinitions } from '@kovojs/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  compilerSpecCoverageMap,
  type DiagnosticCoverageCitation,
  type SpecClause,
} from './spec-coverage-map.js';

const repoRoot = join(import.meta.dirname, '../../..');
const requiredClauses: readonly SpecClause[] = [
  'SPEC.md §4.3',
  'SPEC.md §4.6',
  'SPEC.md §4.8',
  'SPEC.md §4.9',
  'SPEC.md §5.2',
  'SPEC.md §6.1.1',
  'SPEC.md §6.4',
  'SPEC.md §11.3/§11.4',
];

describe('compiler SPEC coverage map', () => {
  it('covers every quantified compiler promise with accepted, diagnostic, and app fixture evidence', () => {
    expect(compilerSpecCoverageMap.map((entry) => entry.clause)).toEqual(requiredClauses);

    for (const entry of compilerSpecCoverageMap) {
      expect(entry.accepted.length, `${entry.clause} needs accepted-path coverage`).toBeGreaterThan(0);
      expect(entry.diagnostics.length, `${entry.clause} needs diagnostic coverage`).toBeGreaterThan(0);
      expect(
        entry.referenceApp.length,
        `${entry.clause} needs reference or commerce app fixture coverage`,
      ).toBeGreaterThan(0);

      for (const citation of [...entry.accepted, ...entry.referenceApp]) {
        expectCitationExists(citation.file, citation.testName);
      }

      for (const citation of entry.diagnostics) {
        expectCitationExists(citation.file, citation.testName);
        const source = readFileSync(join(repoRoot, citation.file), 'utf8');
        const codes = coverageCodes(citation);
        const errorSurface = coverageErrorSurface(citation);
        expect(
          codes.length + (errorSurface ? 1 : 0),
          `${citation.file} ${citation.testName}`,
        ).toBeGreaterThan(0);
        for (const code of codes) {
          expect(diagnosticDefinitions[code], `${code} must exist in SPEC §11.3 registry`).toBeDefined();
          expect(source, `${citation.file} should cite ${code}`).toContain(code);
        }
      }
    }

    const citedFiles = new Set(
      compilerSpecCoverageMap.flatMap((entry) => [
        ...entry.accepted.map((citation) => citation.file),
        ...entry.diagnostics.map((citation) => citation.file),
        ...entry.referenceApp.map((citation) => citation.file),
      ]),
    );
    expect([...citedFiles].some((file) => file.startsWith('examples/reference/'))).toBe(true);
    expect([...citedFiles].some((file) => file.startsWith('examples/commerce/'))).toBe(true);
    expect([...citedFiles].some((file) => file.startsWith('packages/compiler/src/'))).toBe(true);
  });

  it('keeps the map shape compact and reviewable', () => {
    expect(
      compilerSpecCoverageMap.map((entry) => ({
        accepted: entry.accepted.map((citation) => citation.testName),
        clause: entry.clause,
        diagnostics: entry.diagnostics.map((citation) => ({
          codes: coverageCodes(citation).length > 0 ? coverageCodes(citation) : undefined,
          testName: citation.testName,
        })),
        referenceApp: entry.referenceApp.map((citation) => citation.file),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "accepted": [
            "allows handler references through state, element params, named imports, and static module constants",
            "emits executable handler bodies with stable unique anonymous names",
            "declares boolean coercion for boolean-ish captured handler params",
          ],
          "clause": "SPEC.md §4.3",
          "diagnostics": [
            {
              "codes": [
                "KV201",
              ],
              "testName": "reports KV201 when a handler captures non-serializable browser objects",
            },
            {
              "codes": [
                "KV201",
              ],
              "testName": "reports KV201 for captured outer locals that are not element params",
            },
            {
              "codes": [
                "KV201",
              ],
              "testName": "keeps KV201 and KV230 teaching diagnostics compatibility-visible",
            },
          ],
          "referenceApp": [
            "examples/commerce/src/app.add-to-cart.test.ts",
          ],
        },
        {
          "accepted": [
            "merges primitive attrs-function records into the author element on the wire",
            "rewrites primitive IDREFs when an authored id wins in the composition group",
            "lowers asChild primitive wrappers onto the behavior-attribute merge path",
            "lowers attrs-function primitive wrappers onto the behavior-attribute merge path",
          ],
          "clause": "SPEC.md §4.6",
          "diagnostics": [
            {
              "codes": [
                "KV231",
                "KV232",
                "KV233",
              ],
              "testName": "reports KV231, KV232, and KV233 for residual attribute merge conflicts",
            },
            {
              "codes": [
                "KV231",
              ],
              "testName": "names both primitive and author writers for overlapping structural conflicts",
            },
          ],
          "referenceApp": [
            "tests/integration/specs/primitive-as-child.spec.ts",
          ],
        },
        {
          "accepted": [
            "derives data-bind stamps for sole text-child query expressions",
            "wraps mixed text query expressions in synthesized data-bind spans",
            "lowers inline attribute expressions into compiled query update stamps",
            "accepts optional binding path segments through nullable query shape metadata",
            "validates ejected list stamps against array element query shapes",
          ],
          "clause": "SPEC.md §4.8",
          "diagnostics": [
            {
              "codes": [
                "KV227",
              ],
              "testName": "reports KV227 when binding paths traverse nullable query shape metadata without optional segments",
            },
            {
              "codes": [
                "KV302",
              ],
              "testName": "reports KV302 when data-bind paths are absent from declared query shapes",
            },
            {
              "codes": [
                "KV223",
                "KV311",
              ],
              "testName": "classifies query-dependent render positions for KV311 coverage",
            },
            {
              "codes": [
                "KV222",
              ],
              "testName": "proves every in-scope compiler-owned diagnostic has positive and negative coverage",
            },
          ],
          "referenceApp": [
            "examples/commerce/src/app.queries.test.ts",
          ],
        },
        {
          "accepted": [
            "classifies fragment-target query expressions as fragment-covered without KV311",
            "classifies query-dependent render positions as isomorphic when declared",
            "classifies renderOnce coverage from parsed call argument facts",
            "classifies renderOnce state reads without emitting a runtime state plan",
          ],
          "clause": "SPEC.md §4.9",
          "diagnostics": [
            {
              "codes": [
                "KV311",
              ],
              "testName": "reports KV311 for compound query expressions in lowerer-skipped positions",
            },
            {
              "codes": [
                "KV311",
              ],
              "testName": "reports unhandled state and mixed query/state render expressions as KV311",
            },
            {
              "codes": [
                "KV311",
              ],
              "testName": "fails kovo check coverage as a CLI command when coverage is unhandled",
            },
          ],
          "referenceApp": [
            "examples/commerce/src/source-truth.test.ts",
          ],
        },
        {
          "accepted": [
            "preserves emitted IR on recompilation",
            "keeps compiler-emitted IR accepted through explicit fixpoint provenance",
            "executes generated renderSource for semantic render-equivalence checks",
            "uses SPEC §5.2 semantic render equivalence, not source-normalization evidence",
            "inserts generated imports deterministically for mixed structural helpers",
          ],
          "clause": "SPEC.md §5.2",
          "diagnostics": [
            {
              "codes": [
                "KV235",
              ],
              "testName": "reports KV235 for app-authored compiler IR through the header fast path",
            },
            {
              "codes": undefined,
              "testName": "fails the semantic render differential when visible HTML drifts",
            },
            {
              "codes": undefined,
              "testName": "reports fixpoint invariant failures as stable ERROR diagnostics",
            },
          ],
          "referenceApp": [
            "examples/commerce/src/app.rendering.test.ts",
          ],
        },
        {
          "accepted": [
            "accepts an explicit package prefix alias as the collision escape hatch",
            "discovers imported package prefixes from real package manifests",
            "carries explicit package prefix facts into the app explain graph",
          ],
          "clause": "SPEC.md §6.1.1",
          "diagnostics": [
            {
              "codes": [
                "KV234",
              ],
              "testName": "reports KV234 when component packages claim the same effective prefix",
            },
            {
              "codes": [
                "KV234",
              ],
              "testName": "reports KV234 when non-kovo packages use the reserved kovo prefix family",
            },
            {
              "codes": [
                "KV234",
              ],
              "testName": "reports KV234 for missing or invalid package prefix facts",
            },
          ],
          "referenceApp": [
            "packages/cli/src/index.kovo-explain.test.ts",
          ],
        },
        {
          "accepted": [
            "accepts literal navigation targets that match declared routes",
            "lowers static Link navigation sugar to plain anchors",
            "accepts package-prefixed behavior IDREFs that reference ids in component scope",
            "accepts event payload facts that do not overlap query data facts",
          ],
          "clause": "SPEC.md §6.4",
          "diagnostics": [
            {
              "codes": [
                "KV220",
              ],
              "testName": "reports KV220 for literal navigation targets outside the route table",
            },
            {
              "codes": [
                "KV221",
              ],
              "testName": "reports KV221 for package-prefixed behavior IDREFs that miss component scope ids",
            },
            {
              "codes": [
                "KV320",
              ],
              "testName": "reports KV320 when event payload facts overlap query data facts",
            },
          ],
          "referenceApp": [
            "examples/reference/src/app-shell.test.ts",
          ],
        },
        {
          "accepted": [
            "guards the authoritative compiler-owned KV2xx/KV3xx code list",
            "proves every in-scope compiler-owned diagnostic has positive and negative coverage",
            "does not report KV330 for domain-routed mutation handlers",
            "accepts query read domains covered by the touch graph",
          ],
          "clause": "SPEC.md §11.3/§11.4",
          "diagnostics": [
            {
              "codes": [
                "KV330",
              ],
              "testName": "reports KV330 when mutation handlers access request db directly",
            },
            {
              "codes": [
                "KV402",
                "KV403",
                "KV404",
              ],
              "testName": "prints runtime verification diagnostics as kovo check findings",
            },
            {
              "codes": [
                "KV301",
                "KV320",
                "KV330",
              ],
              "testName": "reports semantic lints for local state, events, and direct db access",
            },
          ],
          "referenceApp": [
            "examples/commerce/src/source-truth.test.ts",
            "examples/reference/src/app.test.ts",
          ],
        },
      ]
    `);
  });
});

function expectCitationExists(file: string, testName: string): void {
  const absolutePath = join(repoRoot, file);
  expect(existsSync(absolutePath), `Missing cited SPEC coverage file ${file}`).toBe(true);

  const source = readFileSync(absolutePath, 'utf8');
  expect(source, `Missing cited SPEC coverage test "${testName}" in ${file}`).toContain(testName);
}

function coverageCodes(citation: DiagnosticCoverageCitation): readonly (keyof typeof diagnosticDefinitions)[] {
  return 'codes' in citation ? citation.codes ?? [] : [];
}

function coverageErrorSurface(citation: DiagnosticCoverageCitation): string | undefined {
  return 'errorSurface' in citation ? citation.errorSurface : undefined;
}
