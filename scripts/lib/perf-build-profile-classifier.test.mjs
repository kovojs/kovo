import { describe, expect, it } from 'vitest';

import { deriveBuildProfileTopFive } from './perf-build-profile-classifier.mjs';

describe('build CPU profile classifier', () => {
  it('ranks only exact reviewed phase markers and retains unknown stacks as unattributed', () => {
    const profile = cpuProfile([
      marker('config-trust', 'runPreEvaluationBuildConfigTrustPreflight', 10),
      marker('typescript', 'runTypeScriptBuildPreflight', 9),
      marker('stylesheet', 'kovoBuildStylesheetCss', 8),
      marker('app-source-trust', 'runPreEvaluationStaticTrustPreflight', 7),
      marker('app-evaluation', 'loadBuildAppModule', 6),
      marker('unknown', 'anonymousUserWork', 11, '/tmp/untrusted.mjs'),
    ]);

    expect(deriveBuildProfileTopFive(Buffer.from(JSON.stringify(profile)))).toEqual([
      {
        cause: 'unattributed',
        rank: 1,
        selfSamples: 11,
        sessionEligibility: 'one-shot-or-ineligible',
      },
      {
        cause: 'config-trust',
        rank: 2,
        selfSamples: 10,
        sessionEligibility: 'session-eligible',
      },
      {
        cause: 'typescript',
        rank: 3,
        selfSamples: 9,
        sessionEligibility: 'session-eligible',
      },
      {
        cause: 'stylesheet',
        rank: 4,
        selfSamples: 8,
        sessionEligibility: 'session-eligible',
      },
      {
        cause: 'app-source-trust',
        rank: 5,
        selfSamples: 7,
        sessionEligibility: 'one-shot-or-ineligible',
      },
    ]);
  });

  it('lets a specific phase marker outrank its enclosing worker marker', () => {
    const profile = cpuProfile([
      {
        count: 10,
        frames: [frame('produceKovoBuildOneShotAnalysis'), frame('runTypeScriptBuildPreflight')],
      },
      marker('config-trust', 'runPreEvaluationBuildConfigTrustPreflight', 9),
      marker('stylesheet', 'kovoBuildStylesheetCss', 8),
      marker('app-source-trust', 'runPreEvaluationStaticTrustPreflightInWorker', 7),
      marker('app-evaluation', 'loadBuildAppModule', 6),
    ]);

    expect(deriveBuildProfileTopFive(Buffer.from(JSON.stringify(profile)))[0]).toMatchObject({
      cause: 'typescript',
      selfSamples: 10,
    });
  });

  it('does not relabel parent-side static-trust worker transport as child CPU work', () => {
    const profile = cpuProfile([
      marker('worker-launch-transport', 'runPreEvaluationBuildConfigTrustPreflightInWorker', 10),
      marker('typescript', 'runTypeScriptBuildPreflight', 9),
      marker('stylesheet', 'kovoBuildStylesheetCss', 8),
      marker('app-source-trust', 'runPreEvaluationStaticTrustPreflight', 7),
      marker('app-evaluation', 'loadBuildAppModule', 6),
    ]);

    expect(deriveBuildProfileTopFive(Buffer.from(JSON.stringify(profile)))[0]).toEqual({
      cause: 'worker-launch-transport',
      rank: 1,
      selfSamples: 10,
      sessionEligibility: 'one-shot-or-ineligible',
    });
  });

  it('accepts the signed safe-integer deltas emitted by V8 without weighting samples by them', () => {
    const profile = cpuProfile([
      marker('config-trust', 'runPreEvaluationBuildConfigTrustPreflight', 10),
      marker('typescript', 'runTypeScriptBuildPreflight', 9),
      marker('stylesheet', 'kovoBuildStylesheetCss', 8),
      marker('app-source-trust', 'runPreEvaluationStaticTrustPreflight', 7),
      marker('app-evaluation', 'loadBuildAppModule', 6),
    ]);
    profile.timeDeltas[0] = -1;
    profile.timeDeltas[1] = -57;

    expect(deriveBuildProfileTopFive(Buffer.from(JSON.stringify(profile)))).toHaveLength(5);
    profile.timeDeltas[1] = Number.NEGATIVE_INFINITY;
    expect(() => deriveBuildProfileTopFive(Buffer.from(JSON.stringify(profile)))).toThrow(
      'invalid node/sample/time-delta census',
    );
  });

  it('fails closed on ambiguous or absent reviewed markers', () => {
    const ambiguous = cpuProfile([
      {
        count: 10,
        frames: [frame('runTypeScriptBuildPreflight'), frame('kovoBuildStylesheetCss')],
      },
    ]);
    expect(() => deriveBuildProfileTopFive(Buffer.from(JSON.stringify(ambiguous)))).toThrow(
      'ambiguous reviewed phase markers',
    );

    const absent = cpuProfile([marker('unknown', 'anonymousUserWork', 10, '/tmp/untrusted.mjs')]);
    expect(() => deriveBuildProfileTopFive(Buffer.from(JSON.stringify(absent)))).toThrow(
      'no exact reviewed build marker sample',
    );
  });
});

function cpuProfile(groups) {
  const nodes = [
    {
      callFrame: { functionName: '(root)', url: '' },
      children: groups.map((_, index) => index * 3 + 2),
      id: 1,
    },
  ];
  const samples = [];
  for (const [index, group] of groups.entries()) {
    let parentId = 1;
    for (const [frameIndex, callFrame] of group.frames.entries()) {
      const id = index * 3 + frameIndex + 2;
      const nextId = frameIndex === group.frames.length - 1 ? undefined : id + 1;
      nodes.push({ callFrame, ...(nextId === undefined ? {} : { children: [nextId] }), id });
      parentId = id;
    }
    samples.push(...Array.from({ length: group.count }, () => parentId));
  }
  return { endTime: 1, nodes, samples, startTime: 0, timeDeltas: samples.map(() => 1) };
}

function marker(_cause, functionName, count, url = buildExportUrl()) {
  return { count, frames: [frame(functionName, url)] };
}

function frame(functionName, url = buildExportUrl()) {
  return { columnNumber: 1, functionName, lineNumber: 1, scriptId: '1', url };
}

function buildExportUrl() {
  return 'file:///workspace/packages/cli/src/commands/build-export.ts';
}
