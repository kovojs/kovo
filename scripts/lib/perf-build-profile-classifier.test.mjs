import { describe, expect, it } from 'vitest';

import {
  buildProfileConfigStaticTrustRequired,
  deriveBuildProfileSetAnalysis,
  deriveBuildProfileSourcePhasePosture,
  deriveBuildProfileTopFive,
} from './perf-build-profile-classifier.mjs';
import { KOVO_BUILD_SOURCE_PHASES } from '../perf-build-benchmark.mjs';

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

  it('aggregates the exact process-role census, excludes idle, and ranks native residuals', () => {
    const profiles = processRoleProfiles();
    const typescript = JSON.parse(profiles[3].bytes.toString('utf8'));
    typescript.timeDeltas[0] = -57;
    profiles[3] = { ...profiles[3], bytes: Buffer.from(JSON.stringify(typescript)) };

    const result = deriveBuildProfileSetAnalysis(profiles, {
      nativeOrUnprofiledSamples: 20,
    });

    expect(result.profileCensus.map(({ role }) => role)).toEqual([
      'bootstrap',
      'orchestrator',
      'analyze',
      'typescript',
      'app-static-trust',
      'client',
      'server',
      'final',
    ]);
    expect(result.sampleCensus).toMatchObject({
      active: 33,
      idle: 8,
      nativeOrUnprofiled: 20,
      negativeTimeDeltas: 1,
      total: 41,
      wait: 0,
    });
    expect(result.topFive[0]).toEqual({
      cause: 'native-or-unprofiled',
      rank: 1,
      selfSamples: 20,
      sessionEligibility: 'one-shot-or-ineligible',
    });
    expect(result.causeCensus).toContainEqual({
      cause: 'typescript',
      selfSamples: 4,
      sessionEligibility: 'session-eligible',
    });
  });

  it('retains exact synchronous bootstrap waits without inventing CPU work', () => {
    const profiles = processRoleProfiles();
    profiles[0] = {
      bytes: Buffer.from(
        JSON.stringify(
          cpuProfile([
            marker('role', '', 2, 'file:///workspace/packages/cli/src/bin.ts'),
            {
              count: 100,
              frames: [
                frame('', 'file:///workspace/packages/cli/src/bin.ts'),
                frame('spawnSync', 'node:internal/child_process'),
              ],
            },
            marker('idle', '(idle)', 1, ''),
          ]),
        ),
      ),
      role: 'bootstrap',
    };

    const result = deriveBuildProfileSetAnalysis(profiles);
    expect(result.profileCensus[0]).toMatchObject({
      activeSamples: 2,
      idleSamples: 1,
      waitSamples: 100,
    });
    expect(result.sampleCensus).toMatchObject({ active: 31, idle: 8, total: 139, wait: 100 });
    expect(result.sampleCensus.active + result.sampleCensus.idle + result.sampleCensus.wait).toBe(
      result.sampleCensus.total,
    );
    expect(result.causeCensus).toContainEqual({
      cause: 'cli-startup-tail',
      selfSamples: 2,
      sessionEligibility: 'one-shot-or-ineligible',
    });

    profiles[0] = authenticatedRoleProfile(
      'bootstrap',
      'spawnSync',
      'file:///workspace/packages/cli/src/bin.ts',
    );
    const nearMiss = deriveBuildProfileSetAnalysis(profiles);
    expect(nearMiss.profileCensus[0]).toMatchObject({ activeSamples: 4, waitSamples: 0 });
  });

  it('fails closed when a required process role is absent, duplicated, or unexpectedly added', () => {
    const profiles = processRoleProfiles();
    expect(() => deriveBuildProfileSetAnalysis(profiles.slice(1))).toThrow('role census differs');
    expect(() => deriveBuildProfileSetAnalysis([...profiles, profiles[0]])).toThrow(
      'role census differs',
    );
    expect(() =>
      deriveBuildProfileSetAnalysis([
        ...profiles,
        authenticatedRoleProfile(
          'config-static-trust',
          'runPreEvaluationBuildConfigTrustPreflight',
        ),
      ]),
    ).toThrow('role census differs');
    expect(() =>
      deriveBuildProfileSetAnalysis(
        [
          ...profiles,
          authenticatedRoleProfile(
            'config-static-trust',
            'runPreEvaluationBuildConfigTrustPreflight',
          ),
        ],
        { requireConfigStaticTrust: true },
      ),
    ).not.toThrow();
  });

  it('binds the optional config profile exactly to the authenticated source phase posture', () => {
    const baseProfiles = processRoleProfiles();
    const configProfile = authenticatedRoleProfile(
      'config-static-trust',
      'runPreEvaluationBuildConfigTrustPreflight',
    );
    const executed = deriveBuildProfileSourcePhasePosture(sourcePhaseCensus('executed'));
    const skipped = deriveBuildProfileSourcePhasePosture(sourcePhaseCensus('not-applicable'));

    expect(executed).toEqual({
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({ name, status: 'executed' })),
      schema: 'kovo-build-source-phase-posture/v1',
    });
    expect(JSON.stringify(executed)).not.toContain('durationMs');
    expect(buildProfileConfigStaticTrustRequired(executed)).toBe(true);
    expect(() =>
      deriveBuildProfileSetAnalysis(baseProfiles, {
        requireConfigStaticTrust: buildProfileConfigStaticTrustRequired(executed),
      }),
    ).toThrow('role census differs');
    expect(() =>
      deriveBuildProfileSetAnalysis([...baseProfiles, configProfile], {
        requireConfigStaticTrust: buildProfileConfigStaticTrustRequired(executed),
      }),
    ).not.toThrow();

    expect(buildProfileConfigStaticTrustRequired(skipped)).toBe(false);
    expect(() =>
      deriveBuildProfileSetAnalysis(baseProfiles, {
        requireConfigStaticTrust: buildProfileConfigStaticTrustRequired(skipped),
      }),
    ).not.toThrow();
    expect(() =>
      deriveBuildProfileSetAnalysis([...baseProfiles, configProfile], {
        requireConfigStaticTrust: buildProfileConfigStaticTrustRequired(skipped),
      }),
    ).toThrow('role census differs');
  });

  it('fails closed on missing, duplicate, invalid, or timing-bearing persisted posture', () => {
    const valid = deriveBuildProfileSourcePhasePosture(sourcePhaseCensus('executed'));
    const malformed = [
      undefined,
      { ...structuredClone(valid), phases: valid.phases.slice(0, -1) },
      {
        ...structuredClone(valid),
        phases: valid.phases.map((phase, index) =>
          index === 1 ? { ...phase, name: valid.phases[0].name } : phase,
        ),
      },
      {
        ...structuredClone(valid),
        phases: valid.phases.map((phase, index) =>
          index === 1 ? { ...phase, status: 'skipped' } : phase,
        ),
      },
      {
        ...structuredClone(valid),
        phases: valid.phases.map((phase, index) =>
          index === 1 ? { ...phase, durationMs: 1 } : phase,
        ),
      },
    ];

    for (const posture of malformed) {
      expect(() => buildProfileConfigStaticTrustRequired(posture)).toThrow(/source phase posture/u);
    }
  });

  it('trusts the exec census for an idle orchestrator but rejects exclusive role contradictions', () => {
    const profiles = processRoleProfiles();
    profiles[1] = authenticatedRoleProfile(
      'orchestrator',
      '',
      'file:///workspace/packages/cli/src/bin.ts',
    );
    expect(() => deriveBuildProfileSetAnalysis(profiles)).not.toThrow();

    profiles[1] = authenticatedRoleProfile('orchestrator', 'finishKovoBuildOneShot');
    expect(() => deriveBuildProfileSetAnalysis(profiles)).toThrow(
      'contradicts its authenticated process role',
    );
    expect(() => deriveBuildProfileSetAnalysis(profiles.map(({ bytes }) => bytes))).toThrow(
      'requires authenticated bytes and process roles',
    );
  });
});

function processRoleProfiles() {
  return [
    authenticatedRoleProfile('bootstrap', '', 'file:///workspace/packages/cli/src/bin.ts'),
    authenticatedRoleProfile(
      'orchestrator',
      'runKovoIsolatedOneShotInvocationAsync',
      'file:///workspace/packages/cli/src/commands/build-one-shot-orchestrator.ts',
    ),
    authenticatedRoleProfile('analyze', 'produceKovoBuildOneShotAnalysis', buildExportUrl(), [
      marker(
        'loaded-typescript-library',
        'createProgram',
        1,
        'file:///workspace/node_modules/typescript/lib/typescript.js',
      ),
    ]),
    authenticatedRoleProfile(
      'typescript',
      'executeCommandLine',
      'file:///workspace/node_modules/typescript/lib/_tsc.js',
    ),
    authenticatedRoleProfile('app-static-trust', 'runPreEvaluationStaticTrustPreflight'),
    authenticatedRoleProfile('client', 'produceKovoBuildOneShotClientPhase'),
    authenticatedRoleProfile('server', 'produceKovoBuildOneShotServerPhase'),
    authenticatedRoleProfile('final', 'finishKovoBuildOneShot'),
  ];
}

function sourcePhaseCensus(configStatus) {
  return {
    complete: true,
    phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
      durationMs: 1,
      name,
      status: name === 'config-trust' ? configStatus : 'executed',
    })),
    schema: 'kovo-build-source-phase-census/v1',
  };
}

function authenticatedRoleProfile(role, functionName, url = buildExportUrl(), extraGroups = []) {
  return { bytes: roleProfile(functionName, url, extraGroups), role };
}

function roleProfile(functionName, url = buildExportUrl(), extraGroups = []) {
  return Buffer.from(
    JSON.stringify(
      cpuProfile([
        marker('role', functionName, 4, url),
        ...extraGroups,
        marker('idle', '(idle)', 1, ''),
      ]),
    ),
  );
}

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
