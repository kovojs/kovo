import {
  kovoInvocationEnvironmentValue,
  snapshotKovoInvocationEnvironment,
} from '../invocation-environment.js';

/** @internal Operator-selected security posture pinned before any authored module evaluation. */
export interface KovoCommandSecurityDisposition {
  readonly invocationCwd: string;
  readonly invocationEnv: NodeJS.ProcessEnv;
  readonly paranoidStaticAdvisory: boolean;
}

/** Module-boot fallback for direct dispatcher calls; the bin supplies an even earlier capture. */
export const kovoCommandBootSecurityDisposition = captureKovoCommandSecurityDisposition();

/** @internal Capture supported-runner path authority and environment posture once at command entry. */
export function captureKovoCommandSecurityDisposition(): KovoCommandSecurityDisposition {
  const invocationEnv = snapshotKovoInvocationEnvironment(process.env);
  const value = kovoInvocationEnvironmentValue(invocationEnv, 'KOVO_PARANOID');
  return Object.freeze({
    invocationCwd: process.cwd(),
    invocationEnv,
    paranoidStaticAdvisory: value === '1' || value === 'true',
  });
}
