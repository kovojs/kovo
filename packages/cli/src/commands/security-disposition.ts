/** @internal Operator-selected security posture pinned before any authored module evaluation. */
export interface KovoCommandSecurityDisposition {
  readonly paranoidStaticAdvisory: boolean;
}

/** Module-boot fallback for direct dispatcher calls; the bin supplies an even earlier capture. */
export const kovoCommandBootSecurityDisposition = captureKovoCommandSecurityDisposition();

/** @internal Capture the supported runner's environment posture exactly once at command entry. */
export function captureKovoCommandSecurityDisposition(): KovoCommandSecurityDisposition {
  const value = process.env.KOVO_PARANOID;
  return Object.freeze({ paranoidStaticAdvisory: value === '1' || value === 'true' });
}
