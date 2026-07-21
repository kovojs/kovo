import { describe, expect, it } from 'vitest';
import type { KovoCheckInput } from '@kovojs/core/internal/graph';

import { escapeCensusReviewManifestForBuild } from '../escape-census-review-subjects.js';

const artifactSubject = `sha256:${'b'.repeat(64)}` as const;
const sourceBinding = (file: string, start: number, end: number, digit = 'd') => ({
  encoding: 'utf16le' as const,
  file,
  sliceHash: `sha256:${digit.repeat(64)}` as `sha256:${string}`,
  sourceHash: `sha256:${digit.repeat(64)}` as `sha256:${string}`,
  span: { end, start },
});
const analysisSource = (path: string, digit = 'd', codeUnitLength = 200) => ({
  codeUnitLength,
  contentHash: `sha256:${digit.repeat(64)}` as `sha256:${string}`,
  encoding: 'utf16le' as const,
  path,
  role: 'app' as const,
});
const boundSite = (binding: ReturnType<typeof sourceBinding>, codeUnitLength = 200) => ({
  encoding: 'utf16le' as const,
  file: binding.file,
  sliceHash: binding.sliceHash,
  sourceHash: binding.sourceHash,
  sourceLength: codeUnitLength,
  span: binding.span,
});
const emit = (value: unknown) => escapeCensusReviewManifestForBuild(value as KovoCheckInput);
const coverage = {
  doors: [
    'allowControlChars',
    'csrf:false',
    'ctx.fetch',
    'kovoAnalyzerSummary',
    'trustedHtml',
    'trustedSql',
  ],
  schema: 'kovo.escape-census-coverage/v2',
  sources: {
    allowControlChars: 'trustEscapes',
    'csrf:false': 'trustEscapes',
    'ctx.fetch': 'securitySemanticGraph',
    kovoAnalyzerSummary: 'trustEscapes',
    trustedHtml: 'trustEscapes',
    trustedSql: 'trustEscapes',
  },
} as const;

describe('build Metric E escape-review subject emission (SPEC sections 6.6 and 11.2)', () => {
  // @kovo-security-certifies C13 metric-e-review-subject-emission
  it('emits one artifact-bound subject per counted root and binds every collapsed producer site', () => {
    const graph = {
      analysisInputs: {
        runtimeTarget: 'node',
        schema: 'kovo.analysis.inputs/v1',
        sources: [
          analysisSource('Z.tsx', '5'),
          analysisSource('a.tsx', '6'),
          analysisSource('src/admin.tsx', '1'),
          analysisSource('src/billing.tsx', '3'),
          analysisSource('src/export.tsx', '4'),
          analysisSource('src/sync.tsx', '7'),
        ],
      },
      components: [
        {
          name: 'SyncPanel',
          securityOperations: [
            {
              door: 'handler-root',
              kind: 'server.handler.root',
              target: 'task:sync/run',
            },
          ],
          securitySemanticGraph: {
            budgets: {
              callDepth: 1,
              nodes: 1,
              operations: 1,
              summaries: 1,
            },
            roots: [
              {
                binding: {
                  callback: 'run',
                  callableSpan: { end: 90, start: 50 },
                  factory: 'task',
                  factoryCallSpan: { end: 100, start: 10 },
                  root: 'task:sync/run',
                },
                helperInvocations: [],
                root: 'task:sync/run',
                summaries: [],
                traces: [
                  {
                    root: 'task:sync/run',
                    sink: {
                      door: 'ctx.fetch',
                      kind: 'server.egress.request',
                      sliceHash: `sha256:${'8'.repeat(64)}`,
                      span: { end: 40, start: 30 },
                    },
                    transfers: [],
                    verdict: 'proved',
                  },
                  {
                    root: 'task:sync/run',
                    sink: {
                      door: 'ctx.fetch',
                      kind: 'server.egress.request',
                      sliceHash: `sha256:${'9'.repeat(64)}`,
                      span: { end: 50, start: 42 },
                    },
                    transfers: [],
                    verdict: 'proved',
                  },
                ],
              },
            ],
            schema: 'kovo-security-semantic-graph/v3',
            sourceFile: 'src/sync.tsx',
          },
        },
      ],
      escapeCensus: coverage,
      mutations: [
        {
          csrf: 'exempt',
          key: 'admin/delete',
        },
        {
          csrf: 'exempt',
          key: 'billing/refund',
        },
      ],
      runtimePosture: {
        artifactSubject,
        facts: { endpointAuth: [], egressAllowlist: [], irVersions: [], trustEscapes: [] },
        postureDigest: `sha256:${'c'.repeat(64)}`,
        schema: 'kovo-runtime-posture/v1',
      },
      trustEscapes: [
        {
          countedRoot: 'mutation:admin/delete',
          countedRootDisposition: 'linked',
          kind: 'csrfFalse',
          root: 'mutation:admin/delete',
          site: 'src/admin.tsx:20',
          sourceBinding: sourceBinding('src/admin.tsx', 20, 40, '1'),
        },
        {
          countedRoot: 'mutation:billing/refund',
          countedRootDisposition: 'linked',
          kind: 'csrfFalse',
          root: 'mutation:billing/refund',
          site: 'src/billing.tsx:10',
          sourceBinding: sourceBinding('src/billing.tsx', 10, 30, '3'),
        },
        {
          kind: 'trustedHtml',
          root: 'src/export.tsx:44:88',
          site: 'src/export.tsx:4',
          sourceBinding: sourceBinding('src/export.tsx', 44, 88, '4'),
        },
        {
          kind: 'trustedHtml',
          root: 'Z.tsx:1:2',
          site: 'Z.tsx:1',
          sourceBinding: sourceBinding('Z.tsx', 1, 2, '5'),
        },
        {
          kind: 'trustedHtml',
          root: 'a.tsx:3:4',
          site: 'a.tsx:1',
          sourceBinding: sourceBinding('a.tsx', 3, 4, '6'),
        },
      ],
    } as const;

    expect(emit(graph)).toEqual({
      artifactSubject,
      schema: 'kovo.escape-census-review-subjects/v1',
      subjects: [
        {
          artifactSubject,
          door: 'csrf:false',
          root: 'mutation:admin/delete',
          schema: 'kovo.escape-census-review/v1',
          sites: [boundSite(sourceBinding('src/admin.tsx', 20, 40, '1'))],
        },
        {
          artifactSubject,
          door: 'csrf:false',
          root: 'mutation:billing/refund',
          schema: 'kovo.escape-census-review/v1',
          sites: [boundSite(sourceBinding('src/billing.tsx', 10, 30, '3'))],
        },
        {
          artifactSubject,
          door: 'ctx.fetch',
          root: 'task:sync/run',
          schema: 'kovo.escape-census-review/v1',
          sites: [
            {
              ...boundSite(sourceBinding('src/sync.tsx', 30, 40, '7')),
              sliceHash: `sha256:${'8'.repeat(64)}`,
            },
            {
              ...boundSite(sourceBinding('src/sync.tsx', 42, 50, '7')),
              sliceHash: `sha256:${'9'.repeat(64)}`,
            },
          ],
        },
        {
          artifactSubject,
          door: 'trustedHtml',
          root: 'Z.tsx:1:2',
          schema: 'kovo.escape-census-review/v1',
          sites: [boundSite(sourceBinding('Z.tsx', 1, 2, '5'))],
        },
        {
          artifactSubject,
          door: 'trustedHtml',
          root: 'a.tsx:3:4',
          schema: 'kovo.escape-census-review/v1',
          sites: [boundSite(sourceBinding('a.tsx', 3, 4, '6'))],
        },
        {
          artifactSubject,
          door: 'trustedHtml',
          root: 'src/export.tsx:44:88',
          schema: 'kovo.escape-census-review/v1',
          sites: [boundSite(sourceBinding('src/export.tsx', 44, 88, '4'))],
        },
      ],
    });

    const component = graph.components[0];
    expect(() =>
      emit({
        ...graph,
        components: [{ ...component, securitySemanticGraph: undefined }],
      }),
    ).toThrow('handler roots without a semantic graph');
    expect(() =>
      emit({
        ...graph,
        components: [
          {
            ...component,
            securityOperations: [{ ...component.securityOperations[0], target: 'task:retargeted' }],
          },
        ],
      }),
    ).toThrow('handler root task:retargeted lacks a semantic root');
    expect(() =>
      emit({
        ...graph,
        components: [{ ...component, securityOperations: [] }],
      }),
    ).toThrow('semantic root task:sync/run lacks a handler-root operation');
    expect(() =>
      emit({
        ...graph,
        components: [
          {
            ...component,
            securityOperations: [...component.securityOperations, component.securityOperations[0]],
          },
        ],
      }),
    ).toThrow('duplicate handler root task:sync/run');
    expect(() =>
      emit({
        ...graph,
        components: [
          {
            ...component,
            securitySemanticGraph: {
              ...component.securitySemanticGraph,
              roots: [
                ...component.securitySemanticGraph.roots,
                component.securitySemanticGraph.roots[0],
              ],
            },
          },
        ],
      }),
    ).toThrow('duplicate semantic root task:sync/run');
  });

  it('fails closed on missing coverage, missing roots, and widened producer ownership', () => {
    const base = {
      analysisInputs: {
        runtimeTarget: 'node',
        schema: 'kovo.analysis.inputs/v1',
        sources: [analysisSource('src/export.tsx')],
      },
      components: [],
      escapeCensus: coverage,
      mutations: [],
      runtimePosture: {
        artifactSubject,
        facts: { endpointAuth: [], egressAllowlist: [], irVersions: [], trustEscapes: [] },
        postureDigest: `sha256:${'c'.repeat(64)}`,
        schema: 'kovo-runtime-posture/v1',
      },
      trustEscapes: [
        {
          kind: 'trustedHtml',
          root: 'src/export.tsx:44:88',
          site: 'src/export.tsx:44',
          sourceBinding: sourceBinding('src/export.tsx', 44, 88),
        },
      ],
    } as const;
    expect(() => emit({ ...base, escapeCensus: undefined })).toThrow(
      'exact closed producer-coverage witness',
    );
    expect(() =>
      emit({
        ...base,
        escapeCensus: {
          ...coverage,
          sources: { ...coverage.sources, futureDoor: 'trustEscapes' },
        } as never,
      }),
    ).toThrow('exact closed producer-coverage witness');
    expect(() =>
      emit({
        ...base,
        trustEscapes: [
          {
            kind: 'trustedHtml',
            site: 'src/export.tsx:44',
            sourceBinding: sourceBinding('src/export.tsx', 44, 88),
          },
        ],
      }),
    ).toThrow('lacks an exact UTF-16 source binding');
    expect(() =>
      emit({
        ...base,
        escapeCensus: {
          ...coverage,
          sources: { ...coverage.sources, trustedHtml: 'securitySemanticGraph' },
        } as never,
      }),
    ).toThrow('exact closed producer-coverage witness');
    expect(() => emit({ ...base, trustEscapes: undefined })).toThrow(
      'authoritative trustEscapes array',
    );
    expect(() => emit({ ...base, components: undefined })).toThrow(
      'authoritative components array',
    );
    expect(() => emit({ ...base, mutations: undefined })).toThrow('authoritative mutations array');
    expect(() =>
      emit({
        ...base,
        mutations: [{ csrf: 'exempt', key: 'admin/delete' }],
        trustEscapes: [
          {
            kind: 'csrfFalse',
            root: 'mutation:adminMutation',
            site: 'src/export.tsx:44',
            sourceBinding: sourceBinding('src/export.tsx', 44, 88),
          },
        ],
      }),
    ).toThrow('lacks a closed counted-root disposition');
    expect(() =>
      emit({
        ...base,
        runtimePosture: { artifactSubject: 'sha256:not-a-digest' },
      }),
    ).toThrow('build-owned artifact subject');
  });
});
