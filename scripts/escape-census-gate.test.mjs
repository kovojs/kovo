import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ESCAPE_CENSUS_DOORS,
  ESCAPE_CENSUS_PREDECESSOR,
  evaluateEscapeCensus,
  formatEscapeCensusReport,
  runEscapeCensusCli,
} from './escape-census-gate.mjs';

const zeroBudget = Object.fromEntries(ESCAPE_CENSUS_DOORS.map((door) => [door, 0]));
const auditAmbiguousPathCharacters = [
  ':',
  String.fromCharCode(0x061c),
  ...Array.from({ length: 0x200f - 0x200b + 1 }, (_, index) => String.fromCharCode(0x200b + index)),
  ...Array.from({ length: 0x202e - 0x2028 + 1 }, (_, index) => String.fromCharCode(0x2028 + index)),
  ...Array.from({ length: 0x206f - 0x2060 + 1 }, (_, index) => String.fromCharCode(0x2060 + index)),
  String.fromCharCode(0xfeff),
].map((character) => ({
  character,
  label: `U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
}));
const auditAmbiguousIdentityCharacters = [
  { character: '\n', label: 'U+000A' },
  { character: String.fromCharCode(0x202e), label: 'U+202E' },
];

function budgets(overrides = {}) {
  return {
    schema: 'kovo.escape-budgets/v1',
    packages: {
      '@fixture/app': { ...zeroBudget, ...overrides },
    },
  };
}

function graph(overrides = {}) {
  return {
    analysisInputs: {
      runtimeTarget: 'node',
      schema: 'kovo.analysis.inputs/v1',
      sources: [
        {
          codeUnitLength: 500,
          contentHash: `sha256:${'a'.repeat(64)}`,
          encoding: 'utf16le',
          path: 'app.tsx',
          role: 'app',
        },
      ],
    },
    components: [],
    escapeCensus: {
      doors: ESCAPE_CENSUS_DOORS,
      schema: 'kovo.escape-census-coverage/v2',
      sources: {
        allowControlChars: 'trustEscapes',
        'csrf:false': 'trustEscapes',
        'ctx.fetch': 'securitySemanticGraph',
        kovoAnalyzerSummary: 'trustEscapes',
        trustedHtml: 'trustEscapes',
        trustedSql: 'trustEscapes',
      },
    },
    mutations: [],
    trustEscapes: [],
    ...overrides,
  };
}

function sourceBinding(start, end, sliceDigit = 'b') {
  return {
    encoding: 'utf16le',
    file: 'app.tsx',
    sliceHash: `sha256:${sliceDigit.repeat(64)}`,
    sourceHash: `sha256:${'a'.repeat(64)}`,
    span: { end, start },
  };
}

function trustEscape(kind, start, end, line, extra = {}) {
  return {
    kind,
    root: `app.tsx:${start}:${end}`,
    site: `app.tsx:${line}`,
    sourceBinding: sourceBinding(start, end, String((line % 8) + 1)),
    ...extra,
  };
}

function input(candidateGraph, currentBudgets = budgets(), previousBudgets = currentBudgets) {
  return {
    apps: [{ app: 'fixture', graph: candidateGraph, package: '@fixture/app' }],
    budgets: currentBudgets,
    previousBudgets,
  };
}

function semanticGraph({ root = 'endpoint:/sync', target = 'fetch', transfers = [] } = {}) {
  return {
    budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
    roots: [
      {
        binding: {
          callback: 'handler',
          callableSpan: { end: 20, start: 10 },
          factory: 'endpoint',
          factoryCallSpan: { end: 30, start: 0 },
          root,
        },
        helperInvocations: [],
        root,
        summaries: [],
        traces: [
          {
            root,
            sink: {
              door: 'ctx.fetch',
              kind: 'server.egress.request',
              sliceHash: `sha256:${'c'.repeat(64)}`,
              span: { end: 20, start: 10 },
              target,
            },
            transfers,
            verdict: 'proved',
          },
        ],
      },
    ],
    schema: 'kovo-security-semantic-graph/v3',
    sourceFile: 'app.tsx',
  };
}

describe('escape census gate (C13 anchor)', () => {
  it.each(auditAmbiguousPathCharacters)(
    'rejects audit-ambiguous analysis-input path character $label',
    ({ character }) => {
      const candidate = graph();
      candidate.analysisInputs.sources[0].path = `app${character}.tsx`;
      const result = evaluateEscapeCensus(input(candidate));

      expect(result.findings).toContain('fixture: analysisInputs.sources[0] is malformed');
    },
  );

  it.each(auditAmbiguousIdentityCharacters)(
    'rejects audit-line injection through census identities with $label',
    ({ character }) => {
      const forgedLine = `${character}PACKAGE package=@forged total=0`;
      const invalidApp = evaluateEscapeCensus({
        ...input(graph()),
        apps: [{ app: `fixture${forgedLine}`, graph: graph(), package: '@fixture/app' }],
      });
      const invalidPackage = evaluateEscapeCensus({
        ...input(graph()),
        apps: [{ app: 'fixture', graph: graph(), package: `@fixture/app${forgedLine}` }],
      });
      const invalidRoot = evaluateEscapeCensus(
        input(
          graph({
            components: [
              {
                name: 'App',
                securityOperations: [
                  {
                    door: 'handler-root',
                    kind: 'server.handler.root',
                    target: `endpoint:/sync${forgedLine}`,
                  },
                ],
                securitySemanticGraph: semanticGraph({ root: `endpoint:/sync${forgedLine}` }),
              },
            ],
          }),
        ),
      );
      const invalidTransfer = evaluateEscapeCensus(
        input(
          graph({
            components: [
              {
                name: 'App',
                securityOperations: [
                  {
                    door: 'handler-root',
                    kind: 'server.handler.root',
                    target: 'endpoint:/sync',
                  },
                ],
                securitySemanticGraph: semanticGraph({ transfers: [`local:again${forgedLine}`] }),
              },
            ],
          }),
        ),
      );
      const invalidTarget = evaluateEscapeCensus(
        input(
          graph({
            components: [
              {
                name: 'App',
                securityOperations: [
                  {
                    door: 'handler-root',
                    kind: 'server.handler.root',
                    target: 'endpoint:/sync',
                  },
                ],
                securitySemanticGraph: semanticGraph({ target: `fetch${forgedLine}` }),
              },
            ],
          }),
        ),
      );
      const invalidComponent = evaluateEscapeCensus(
        input(
          graph({
            components: [
              {
                name: `App${forgedLine}`,
                securityOperations: [
                  {
                    door: 'handler-root',
                    kind: 'server.handler.root',
                    root: 'endpoint:/sync',
                  },
                ],
              },
            ],
          }),
        ),
      );
      const invalidBudgetDocument = {
        packages: { [`@fixture/app${forgedLine}`]: zeroBudget },
        schema: 'kovo.escape-budgets/v1',
      };
      const invalidBudget = evaluateEscapeCensus(
        input(graph(), invalidBudgetDocument, invalidBudgetDocument),
      );

      expect(invalidApp.findings).toContain('apps[0]: app must be a non-blank string');
      expect(invalidPackage.findings).toContain('apps[0]: package must be a non-blank string');
      expect(invalidRoot.findings).toContain(
        'fixture/App: securitySemanticGraph.roots[0] must carry a non-blank root',
      );
      expect(invalidTransfer.findings).toContain(
        'fixture/App: securitySemanticGraph.roots[0].traces[0].transfers must be an array of non-blank identities',
      );
      expect(invalidTarget.findings).toContain(
        'fixture/App: securitySemanticGraph.roots[0].traces[0].sink.target must be a bounded printable identity',
      );
      expect(invalidComponent.findings).toContain(
        'fixture: components[0].name must be bounded printable text',
      );
      expect(invalidBudget.findings).toContain('budgets: invalid package budget <invalid>');
      for (const result of [
        invalidApp,
        invalidBudget,
        invalidComponent,
        invalidPackage,
        invalidRoot,
        invalidTransfer,
        invalidTarget,
      ]) {
        expect(formatEscapeCensusReport(result.report)).not.toContain(
          'PACKAGE package=@forged total=0',
        );
        expect(result.findings.join('\n')).not.toContain('PACKAGE package=@forged total=0');
      }
    },
  );

  it.each([
    { decorate: (value) => ` ${value}`, label: 'leading whitespace' },
    { decorate: (value) => `${value} `, label: 'trailing whitespace' },
  ])('rejects $label at census identity boundaries', ({ decorate }) => {
    const invalidApp = evaluateEscapeCensus({
      ...input(graph()),
      apps: [{ app: decorate('fixture'), graph: graph(), package: '@fixture/app' }],
    });
    const invalidPackage = evaluateEscapeCensus({
      ...input(graph()),
      apps: [{ app: 'fixture', graph: graph(), package: decorate('@fixture/app') }],
    });
    const root = decorate('endpoint:/sync');
    const invalidRoot = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
              securityOperations: [
                { door: 'handler-root', kind: 'server.handler.root', target: root },
              ],
              securitySemanticGraph: semanticGraph({ root }),
            },
          ],
        }),
      ),
    );
    const invalidTarget = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
              securityOperations: [
                {
                  door: 'handler-root',
                  kind: 'server.handler.root',
                  target: 'endpoint:/sync',
                },
              ],
              securitySemanticGraph: semanticGraph({ target: decorate('fetch') }),
            },
          ],
        }),
      ),
    );

    expect(invalidApp.findings).toContain('apps[0]: app must be a non-blank string');
    expect(invalidPackage.findings).toContain('apps[0]: package must be a non-blank string');
    expect(invalidRoot.findings).toContain(
      'fixture/App: securitySemanticGraph.roots[0] must carry a non-blank root',
    );
    expect(invalidTarget.findings).toContain(
      'fixture/App: securitySemanticGraph.roots[0].traces[0].sink.target must be a bounded printable identity',
    );
  });

  it('JSON-quotes printable identity whitespace in the line-oriented report', () => {
    const result = evaluateEscapeCensus({
      ...input(graph()),
      apps: [
        {
          app: 'fixture package=@forged',
          graph: graph(),
          package: '@fixture/app',
        },
      ],
    });

    expect(result.findings).toEqual([]);
    expect(formatEscapeCensusReport(result.report)).toContain(
      'ESCAPE app="fixture package=@forged" package="@fixture/app"',
    );
    expect(formatEscapeCensusReport(result.report)).not.toContain(
      'ESCAPE app=fixture package=@forged package=',
    );
  });

  it('counts distinct escaped roots per app and door without double-counting trace fanout', () => {
    const result = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
              securityOperations: [
                {
                  door: 'handler-root',
                  kind: 'server.handler.root',
                  target: 'endpoint:/sync',
                },
              ],
              securitySemanticGraph: {
                budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
                roots: [
                  {
                    binding: {
                      callback: 'handler',
                      callableSpan: { end: 20, start: 10 },
                      factory: 'endpoint',
                      factoryCallSpan: { end: 30, start: 0 },
                      root: 'endpoint:/sync',
                    },
                    helperInvocations: [],
                    root: 'endpoint:/sync',
                    summaries: [],
                    traces: [
                      {
                        root: 'endpoint:/sync',
                        sink: {
                          door: 'ctx.fetch',
                          kind: 'server.egress.request',
                          sliceHash: `sha256:${'c'.repeat(64)}`,
                          span: { end: 20, start: 10 },
                          target: 'first',
                        },
                        transfers: [],
                        verdict: 'proved',
                      },
                      {
                        root: 'endpoint:/sync',
                        sink: {
                          door: 'ctx.fetch',
                          kind: 'server.egress.request',
                          sliceHash: `sha256:${'d'.repeat(64)}`,
                          span: { end: 40, start: 30 },
                          target: 'second',
                        },
                        transfers: ['local:again[arg0=context]'],
                        verdict: 'proved',
                      },
                    ],
                  },
                ],
                schema: 'kovo-security-semantic-graph/v3',
                sourceFile: 'app.tsx',
              },
            },
          ],
          mutations: [
            {
              csrf: 'exempt',
              csrfJustification: 'signed machine caller',
              key: 'machine/write',
            },
          ],
          trustEscapes: [
            trustEscape('trustedHtml', 60, 70, 4),
            trustEscape('trustedSql', 80, 90, 8),
            trustEscape('csrfFalse', 100, 110, 11, {
              countedRootDisposition: 'proven-unreachable',
              root: 'mutation:machineWrite',
            }),
            trustEscape('csrfFalse', 120, 130, 12, {
              countedRoot: 'mutation:machine/write',
              countedRootDisposition: 'linked',
              root: 'mutation:machine/write',
            }),
            trustEscape('kovoAnalyzerSummary', 140, 150, 7),
            trustEscape('allowControlChars', 160, 170, 3),
          ],
        }),
        budgets({
          allowControlChars: 1,
          'csrf:false': 1,
          'ctx.fetch': 1,
          kovoAnalyzerSummary: 1,
          trustedHtml: 1,
          trustedSql: 1,
        }),
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.report.apps[0]?.doors).toEqual({
      allowControlChars: 1,
      'csrf:false': 1,
      'ctx.fetch': 1,
      kovoAnalyzerSummary: 1,
      trustedHtml: 1,
      trustedSql: 1,
    });
    expect(formatEscapeCensusReport(result.report)).toContain(
      'ESCAPE app="fixture" package="@fixture/app" door="ctx.fetch" roots=1',
    );
  });

  it('fails closed when coverage, semantic roots, or exact escape facts are absent', () => {
    expect(evaluateEscapeCensus(input({})).findings).toContain(
      'fixture: missing kovo.escape-census-coverage/v2 producer witness',
    );
    expect(evaluateEscapeCensus(input({})).findings).toContain(
      'fixture: authoritative trustEscapes array is absent',
    );

    const missingSemantic = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
              securityOperations: [
                {
                  door: 'handler-root',
                  kind: 'server.handler.root',
                  target: 'endpoint:/sync',
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(missingSemantic.findings).toContain(
      'fixture/App: server handler roots are present but securitySemanticGraph is absent',
    );

    const missingCsrfFact = evaluateEscapeCensus(
      input(
        graph({
          mutations: [
            {
              csrf: 'exempt',
              csrfJustification: 'signed machine caller',
              key: 'machine/write',
            },
          ],
        }),
      ),
    );
    expect(missingCsrfFact.findings).toContain(
      'fixture: csrf-exempt mutation machine/write has no csrfFalse trust-escape root',
    );
  });

  it('requires exact one-to-one handler targets and semantic roots', () => {
    const component = (securityOperations, securitySemanticGraph = semanticGraph()) => ({
      name: 'App',
      securityOperations,
      securitySemanticGraph,
    });
    const handler = (target) => ({
      door: 'handler-root',
      kind: 'server.handler.root',
      target,
    });

    const retargeted = evaluateEscapeCensus(
      input(graph({ components: [component([handler('endpoint:/retargeted')])] })),
    );
    expect(retargeted.findings).toEqual(
      expect.arrayContaining([
        'fixture/App: server handler root endpoint:/retargeted is absent from semantic graph',
        'fixture/App: semantic root endpoint:/sync has no server handler-root operation',
      ]),
    );

    const omitted = evaluateEscapeCensus(input(graph({ components: [component([])] })));
    expect(omitted.findings).toContain(
      'fixture/App: semantic root endpoint:/sync has no server handler-root operation',
    );

    const duplicateHandlers = evaluateEscapeCensus(
      input(
        graph({
          components: [component([handler('endpoint:/sync'), handler('endpoint:/sync')])],
        }),
      ),
    );
    expect(duplicateHandlers.findings).toContain(
      'fixture/App: duplicate server handler root endpoint:/sync',
    );

    const duplicatedSemantic = semanticGraph();
    duplicatedSemantic.roots.push(structuredClone(duplicatedSemantic.roots[0]));
    const duplicateSemanticRoots = evaluateEscapeCensus(
      input(
        graph({
          components: [component([handler('endpoint:/sync')], duplicatedSemantic)],
        }),
      ),
    );
    expect(duplicateSemanticRoots.findings).toContain(
      'fixture/App: securitySemanticGraph.roots[1] duplicates semantic root endpoint:/sync',
    );

    const legacyRootField = evaluateEscapeCensus(
      input(
        graph({
          components: [
            component([
              { door: 'handler-root', kind: 'server.handler.root', root: 'endpoint:/sync' },
            ]),
          ],
        }),
      ),
    );
    expect(legacyRootField.findings).toContain(
      'fixture/App: securityOperations[0] handler root must carry a bounded printable target',
    );
  });

  it('rejects unsupported trust kinds and any per-package budget increase', () => {
    const unknown = evaluateEscapeCensus(
      input(
        graph({ trustEscapes: [{ kind: 'futureEscape', root: 'app.ts:1', site: 'app.ts:1' }] }),
      ),
    );
    expect(unknown.findings).toContain('fixture: unsupported trust-escape kind futureEscape');

    const grown = evaluateEscapeCensus(
      input(graph(), budgets({ trustedHtml: 2 }), budgets({ trustedHtml: 1 })),
    );
    expect(grown.findings).toContain(
      '@fixture/app: trustedHtml budget increased from 1 to 2; escape budgets are monotone',
    );

    const missingPackage = evaluateEscapeCensus(
      input(graph(), { packages: {}, schema: 'kovo.escape-budgets/v1' }),
    );
    expect(missingPackage.findings).toContain('@fixture/app: missing per-package escape budget');
  });

  it('fails closed on malformed sites and semantic slices that disagree with trust facts', () => {
    const malformed = graph({
      trustEscapes: [
        {
          ...trustEscape('trustedHtml', 40, 50, 4),
          site: undefined,
        },
      ],
    });
    expect(() => evaluateEscapeCensus(input(malformed))).not.toThrow();
    expect(evaluateEscapeCensus(input(malformed)).findings).toContain(
      'fixture: trustEscapes[0] must carry an exact UTF-16 source binding',
    );

    const exactTrust = trustEscape('trustedHtml', 40, 50, 4);
    const mismatched = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
              securityOperations: [
                {
                  door: 'handler-root',
                  kind: 'server.handler.root',
                  target: 'route:/app',
                },
              ],
              securitySemanticGraph: {
                budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
                roots: [
                  {
                    binding: { factory: 'page', root: 'route:/app' },
                    root: 'route:/app',
                    traces: [
                      {
                        root: 'route:/app',
                        sink: {
                          door: 'trustedHtml',
                          kind: 'server.html.trusted',
                          sliceHash: `sha256:${'f'.repeat(64)}`,
                          span: { end: 50, start: 40 },
                          target: 'trustedHtml',
                        },
                        transfers: [],
                        verdict: 'proved',
                      },
                    ],
                  },
                ],
                schema: 'kovo-security-semantic-graph/v3',
                sourceFile: 'app.tsx',
              },
            },
          ],
          trustEscapes: [exactTrust],
        }),
        budgets({ trustedHtml: 1 }),
      ),
    );
    expect(mismatched.findings).toContain(
      'fixture/App: securitySemanticGraph.roots[0].traces[0] lacks its exact trustedHtml trust-escape fact',
    );
  });

  it('fails when current roots exceed a package budget and reports each exact root', () => {
    const result = evaluateEscapeCensus(
      input(
        graph({
          trustEscapes: [
            trustEscape('trustedHtml', 40, 50, 4),
            trustEscape('trustedHtml', 90, 100, 9),
          ],
        }),
        budgets({ trustedHtml: 1 }),
      ),
    );

    expect(result.findings).toContain(
      '@fixture/app: trustedHtml escaped roots 2 exceed budget 1 (["fixture","app.tsx:40:50"], ["fixture","app.tsx:90:100"])',
    );
  });

  it('reads only declared graph and budget artifacts through the CLI config', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-escape-census-'));
    const output = { stderr: '', stdout: '' };
    const io = {
      stderr: { write: (chunk) => (output.stderr += String(chunk)) },
      stdout: { write: (chunk) => (output.stdout += String(chunk)) },
    };

    try {
      writeFileSync(join(root, 'graph.json'), JSON.stringify(graph()), 'utf8');
      writeFileSync(join(root, 'budgets.json'), JSON.stringify(budgets()), 'utf8');
      writeFileSync(
        join(root, 'escape-budgets.previous.json'),
        readFileSync(resolve('security/escape-budgets.previous.json')),
      );
      writeFileSync(
        join(root, 'config.json'),
        JSON.stringify({
          apps: [
            {
              app: 'fixture',
              graph: './graph.json',
              package: '@fixture/app',
            },
          ],
          budgets: './budgets.json',
          previousBudgets: ESCAPE_CENSUS_PREDECESSOR,
          schema: 'kovo.escape-census-config/v1',
        }),
        'utf8',
      );

      expect(runEscapeCensusCli(['--config', join(root, 'config.json')], io)).toBe(0);
      expect(output.stderr).toBe('');
      expect(output.stdout).toContain('kovo.escape-census/v2');
      expect(output.stdout).toContain('PACKAGE package="@fixture/app" total=0');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects same-tip current/predecessor ceiling co-edits and forged anchor metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-escape-census-ratchet-'));
    const output = { stderr: '', stdout: '' };
    const io = {
      stderr: { write: (chunk) => (output.stderr += String(chunk)) },
      stdout: { write: (chunk) => (output.stdout += String(chunk)) },
    };
    const raised = budgets({ trustedHtml: 2 });
    const configPath = join(root, 'config.json');

    try {
      writeFileSync(join(root, 'graph.json'), JSON.stringify(graph()), 'utf8');
      writeFileSync(join(root, 'budgets.json'), JSON.stringify(raised), 'utf8');
      writeFileSync(join(root, 'escape-budgets.previous.json'), JSON.stringify(raised), 'utf8');
      writeFileSync(
        configPath,
        JSON.stringify({
          apps: [{ app: 'fixture', graph: './graph.json', package: '@fixture/app' }],
          budgets: './budgets.json',
          previousBudgets: ESCAPE_CENSUS_PREDECESSOR,
          schema: 'kovo.escape-census-config/v1',
        }),
        'utf8',
      );

      expect(runEscapeCensusCli(['--config', configPath], io)).toBe(1);
      expect(output.stderr).toContain('previousBudgets digest drifted');

      output.stderr = '';
      writeFileSync(
        configPath,
        JSON.stringify({
          apps: [{ app: 'fixture', graph: './graph.json', package: '@fixture/app' }],
          budgets: './budgets.json',
          previousBudgets: { ...ESCAPE_CENSUS_PREDECESSOR, sha256: '0'.repeat(64) },
          schema: 'kovo.escape-census-config/v1',
        }),
        'utf8',
      );
      expect(runEscapeCensusCli(['--config', configPath], io)).toBe(1);
      expect(output.stderr).toContain('previousBudgets anchor drifted');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
