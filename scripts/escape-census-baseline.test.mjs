import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ESCAPE_CENSUS_DOORS, ESCAPE_CENSUS_PREDECESSOR } from './escape-census-gate.mjs';
import {
  deriveEscapeCensusReviewManifest,
  ESCAPE_CENSUS_BASELINE_COMMAND,
  verifyEscapeCensusBaseline,
} from './escape-census-baseline.mjs';

const repoRoot = process.cwd();
const baseline = JSON.parse(
  readFileSync(resolve(repoRoot, 'security/escape-census-baseline.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(resolve(repoRoot, 'security/escape-budgets.json'), 'utf8'));
const previousBudgets = JSON.parse(
  readFileSync(resolve(repoRoot, 'security/escape-budgets.previous.json'), 'utf8'),
);
const reviewSubjects = structuredClone(baseline.reviewSubjects);

function representativeGraph() {
  const subjects = Object.fromEntries(
    reviewSubjects[0].manifest.subjects.map((subject) => [subject.door, subject]),
  );
  const source = subjects.allowControlChars.sites[0];
  const sourceBinding = (door) => {
    const site = subjects[door].sites[0];
    return {
      encoding: site.encoding,
      file: site.file,
      sliceHash: site.sliceHash,
      sourceHash: site.sourceHash,
      span: site.span,
    };
  };
  const graph = {
    analysisInputs: {
      runtimeTarget: 'node',
      schema: 'kovo.analysis.inputs/v1',
      sources: [
        {
          codeUnitLength: source.sourceLength,
          contentHash: source.sourceHash,
          encoding: 'utf16le',
          path: source.file,
          role: 'app',
        },
      ],
    },
    components: [
      {
        name: 'app/admin-page',
        securityOperations: [
          {
            door: 'handler-root',
            kind: 'server.handler.root',
            target: 'mutation:app/admin-mutation',
          },
          {
            door: 'handler-root',
            kind: 'server.handler.root',
            target: 'query:app/admin-query',
          },
        ],
        securitySemanticGraph: {
          budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
          roots: [
            {
              binding: {
                factory: 'mutation',
                factoryCallSpan: { end: 641, start: 427 },
                root: 'mutation:app/admin-mutation',
              },
              root: 'mutation:app/admin-mutation',
              traces: [],
            },
            {
              binding: {
                factory: 'query',
                factoryCallSpan: { end: 908, start: 752 },
                root: 'query:app/admin-query',
              },
              root: 'query:app/admin-query',
              traces: [],
            },
          ],
          schema: 'kovo-security-semantic-graph/v3',
          sourceFile: source.file,
        },
      },
    ],
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
    mutations: [
      {
        csrf: 'exempt',
        csrfJustification: 'non-browser Metric E representative app',
        key: 'app/admin-mutation',
      },
    ],
    runtimePosture: {
      artifactSubject: reviewSubjects[0].manifest.artifactSubject,
    },
    trustEscapes: [
      {
        kind: 'allowControlChars',
        root: subjects.allowControlChars.root,
        site: 'app.tsx:19',
        sourceBinding: sourceBinding('allowControlChars'),
      },
      {
        countedRoot: 'mutation:app/admin-mutation',
        countedRootDisposition: 'linked',
        kind: 'csrfFalse',
        root: 'mutation:adminMutation',
        site: 'app.tsx:15',
        source: 'adminMutation',
        sourceBinding: sourceBinding('csrf:false'),
      },
      {
        kind: 'trustedHtml',
        root: subjects.trustedHtml.root,
        site: 'app.tsx:32',
        sourceBinding: sourceBinding('trustedHtml'),
      },
    ],
  };
  graph.runtimePosture.artifactSubject = artifactSubjectForGraph(graph);
  return graph;
}

function artifactSubjectForGraph(graph) {
  const subjectGraph = Object.fromEntries(
    Object.entries(graph).filter(([key]) => key !== 'runtimePosture'),
  );
  return `sha256:${createHash('sha256').update(canonicalGraphJson(subjectGraph)).digest('hex')}`;
}

function refreshArtifactSubject(graph) {
  graph.runtimePosture.artifactSubject = artifactSubjectForGraph(graph);
  return graph;
}

function canonicalGraphJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalGraphJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalGraphJson(value[key])}`)
    .join(',')}}`;
}

const representativeArtifactSubject = representativeGraph().runtimePosture.artifactSubject;
for (const entry of reviewSubjects) {
  entry.manifest.artifactSubject = representativeArtifactSubject;
  for (const subject of entry.manifest.subjects) {
    subject.artifactSubject = representativeArtifactSubject;
  }
}
baseline.reviewSubjects = structuredClone(reviewSubjects);

function representativeInputs() {
  return {
    apps: [
      {
        app: 'metric-e-representative',
        graph: representativeGraph(),
        package: '@kovojs/security-metric-e-app',
      },
    ],
    budgets: structuredClone(budgets),
    previousBudgets: structuredClone(previousBudgets),
  };
}

describe('persisted Metric E real-app baseline', () => {
  it('pins the exact command, report, and mandatory negative-control membership', () => {
    expect(baseline.command).toBe(ESCAPE_CENSUS_BASELINE_COMMAND);
    expect(baseline.predecessor).toEqual(ESCAPE_CENSUS_PREDECESSOR);
    expect(() =>
      verifyEscapeCensusBaseline({
        baseline,
        inputs: representativeInputs(),
        reviewSubjects,
      }),
    ).not.toThrow();
  });

  it('rejects a representative app whose observed roots exceed the persisted budget', () => {
    const inputs = representativeInputs();
    inputs.budgets.packages['@kovojs/security-metric-e-app'].trustedHtml = 0;

    expect(() => verifyEscapeCensusBaseline({ baseline, inputs, reviewSubjects })).toThrow(
      '@kovojs/security-metric-e-app: trustedHtml escaped roots 1 exceed budget 0',
    );
  });

  it('rejects missing or forged producer provenance before accepting the report', () => {
    const missing = representativeInputs();
    delete missing.apps[0].graph.escapeCensus;
    expect(() => verifyEscapeCensusBaseline({ baseline, inputs: missing, reviewSubjects })).toThrow(
      'missing kovo.escape-census-coverage/v2 producer witness',
    );

    const forged = representativeInputs();
    forged.apps[0].graph.escapeCensus.sources.trustedHtml = 'unreviewed-producer';
    expect(() => verifyEscapeCensusBaseline({ baseline, inputs: forged, reviewSubjects })).toThrow(
      'escape-census door trustedHtml must derive from trustEscapes',
    );
  });

  it('independently rejects omitted or cross-root producer sites even when counts are unchanged', () => {
    const inputs = representativeInputs();
    expect(deriveEscapeCensusReviewManifest(inputs.apps[0].graph)).toEqual(
      reviewSubjects[0].manifest,
    );

    const omitted = structuredClone(reviewSubjects);
    omitted[0].manifest.subjects.find((subject) => subject.door === 'csrf:false').sites = [];
    expect(() => verifyEscapeCensusBaseline({ baseline, inputs, reviewSubjects: omitted })).toThrow(
      'independent producer oracle',
    );

    const crossRoot = representativeInputs();
    crossRoot.apps[0].graph.trustEscapes[1].countedRoot = 'mutation:unrelated/write';
    expect(() =>
      verifyEscapeCensusBaseline({ baseline, inputs: crossRoot, reviewSubjects }),
    ).toThrow('closed counted-root disposition');

    const ambiguous = representativeInputs();
    delete ambiguous.apps[0].graph.trustEscapes[1].countedRoot;
    delete ambiguous.apps[0].graph.trustEscapes[1].countedRootDisposition;
    expect(() =>
      verifyEscapeCensusBaseline({ baseline, inputs: ambiguous, reviewSubjects }),
    ).toThrow('closed counted-root disposition');

    const missingSemanticGraph = representativeGraph();
    delete missingSemanticGraph.components[0].securitySemanticGraph;
    expect(() =>
      deriveEscapeCensusReviewManifest(refreshArtifactSubject(missingSemanticGraph)),
    ).toThrow('handler roots without a semantic graph');

    const retargetedHandler = representativeGraph();
    retargetedHandler.components[0].securityOperations[0].target = 'mutation:retargeted';
    expect(() =>
      deriveEscapeCensusReviewManifest(refreshArtifactSubject(retargetedHandler)),
    ).toThrow('handler root mutation:retargeted lacks a semantic root');

    const omittedHandler = representativeGraph();
    omittedHandler.components[0].securityOperations.shift();
    expect(() => deriveEscapeCensusReviewManifest(refreshArtifactSubject(omittedHandler))).toThrow(
      'semantic root mutation:app/admin-mutation lacks a handler-root operation',
    );
  });

  it('recomputes the graph artifact subject instead of trusting coordinated forged evidence', () => {
    const inputs = representativeInputs();
    inputs.apps[0].graph.auditNoise = 'changed after review';
    const forgedSubject = `sha256:${'f'.repeat(64)}`;
    inputs.apps[0].graph.runtimePosture.artifactSubject = forgedSubject;

    const forgedReviewSubjects = structuredClone(reviewSubjects);
    for (const entry of forgedReviewSubjects) {
      entry.manifest.artifactSubject = forgedSubject;
      for (const subject of entry.manifest.subjects) subject.artifactSubject = forgedSubject;
    }
    const forgedBaseline = structuredClone(baseline);
    forgedBaseline.reviewSubjects = structuredClone(forgedReviewSubjects);

    expect(() =>
      verifyEscapeCensusBaseline({
        baseline: forgedBaseline,
        inputs,
        reviewSubjects: forgedReviewSubjects,
      }),
    ).toThrow('artifact subject mismatch');
  });

  it('rejects a rewritten baseline command or weakened negative-control expectation', () => {
    expect(() =>
      verifyEscapeCensusBaseline({
        baseline: { ...baseline, command: 'node scripts/escape-census-gate.mjs' },
        inputs: representativeInputs(),
        reviewSubjects,
      }),
    ).toThrow('baseline command drifted');

    const weakened = structuredClone(baseline);
    weakened.negativeChecks[0].expectedFindings = [];
    expect(() =>
      verifyEscapeCensusBaseline({
        baseline: weakened,
        inputs: representativeInputs(),
        reviewSubjects,
      }),
    ).toThrow('negative check budget-ceiling drifted');

    expect(() =>
      verifyEscapeCensusBaseline({
        baseline: {
          ...baseline,
          predecessor: { ...ESCAPE_CENSUS_PREDECESSOR, sha256: '0'.repeat(64) },
        },
        inputs: representativeInputs(),
        reviewSubjects,
      }),
    ).toThrow('baseline predecessor anchor drifted');
  });
});
