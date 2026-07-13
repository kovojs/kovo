/** @internal Operator-selected security posture pinned before any authored module evaluation. */
export interface KovoCommandSecurityDisposition {
  readonly invocationCwd: string;
  readonly paranoidStaticAdvisory: boolean;
}

/** Module-boot fallback for direct dispatcher calls; the bin supplies an even earlier capture. */
export const kovoCommandBootSecurityDisposition = captureKovoCommandSecurityDisposition();

/** @internal Capture supported-runner path authority and environment posture once at command entry. */
export function captureKovoCommandSecurityDisposition(): KovoCommandSecurityDisposition {
  const value = process.env.KOVO_PARANOID;
  return Object.freeze({
    invocationCwd: process.cwd(),
    paranoidStaticAdvisory: value === '1' || value === 'true',
  });
}
