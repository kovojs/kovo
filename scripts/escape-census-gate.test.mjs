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
    components: [],
    escapeCensus: {
      doors: ESCAPE_CENSUS_DOORS,
      schema: 'kovo.escape-census-coverage/v1',
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

function input(candidateGraph, currentBudgets = budgets(), previousBudgets = currentBudgets) {
  return {
    apps: [{ app: 'fixture', graph: candidateGraph, package: '@fixture/app' }],
    budgets: currentBudgets,
    previousBudgets,
  };
}

describe('escape census gate (C13 anchor)', () => {
  it('counts distinct escaped roots per app and door without double-counting trace fanout', () => {
    const result = evaluateEscapeCensus(
      input(
        graph({
          components: [
            {
              name: 'App',
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
                          target: 'second',
                        },
                        transfers: ['local:again[arg0=context]'],
                        verdict: 'proved',
                      },
                    ],
                  },
                ],
                schema: 'kovo-security-semantic-graph/v2',
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
            { kind: 'trustedHtml', root: 'app.tsx:4', site: 'app.tsx:4' },
            { kind: 'trustedSql', root: 'db.ts:8', site: 'db.ts:8' },
            { kind: 'csrfFalse', root: 'mutation:machineWrite', site: 'app.ts:11' },
            { kind: 'csrfFalse', root: 'mutation:machine/write', site: 'app.ts:12' },
            { kind: 'kovoAnalyzerSummary', root: 'scope.ts:7', site: 'scope.ts:7' },
            { kind: 'allowControlChars', root: 'schema.ts:3', site: 'schema.ts:3' },
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
      'ESCAPE app=fixture package=@fixture/app door=ctx.fetch roots=1',
    );
  });

  it('fails closed when coverage, semantic roots, or exact escape facts are absent', () => {
    expect(evaluateEscapeCensus(input({})).findings).toContain(
      'fixture: missing kovo.escape-census-coverage/v1 producer witness',
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
                  root: 'endpoint:/sync',
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

  it('fails when current roots exceed a package budget and reports each exact root', () => {
    const result = evaluateEscapeCensus(
      input(
        graph({
          trustEscapes: [
            { kind: 'trustedHtml', root: 'app.tsx:4', site: 'app.tsx:4' },
            { kind: 'trustedHtml', root: 'app.tsx:9', site: 'app.tsx:9' },
          ],
        }),
        budgets({ trustedHtml: 1 }),
      ),
    );

    expect(result.findings).toContain(
      '@fixture/app: trustedHtml escaped roots 2 exceed budget 1 (["fixture","app.tsx:4"], ["fixture","app.tsx:9"])',
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
      expect(output.stdout).toContain('kovo.escape-census/v1');
      expect(output.stdout).toContain('PACKAGE package=@fixture/app total=0');
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
