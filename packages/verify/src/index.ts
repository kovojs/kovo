/** The seven raw authority kinds certified by `kovo.certificate/v1` (SPEC §6.6). */
export const KOVO_CERTIFICATE_CAPABILITY_DOMAIN = [
  'database-driver',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
] as const;

/** A raw authority kind in a Kovo artifact certificate. */
export type KovoCertificateCapabilityKind = (typeof KOVO_CERTIFICATE_CAPABILITY_DOMAIN)[number];

/** An untrusted-data root kind in a Kovo artifact certificate. */
export type KovoCertificateRootKind =
  | 'agent-tool-callback'
  | 'application'
  | 'durable-task'
  | 'endpoint'
  | 'layout'
  | 'mutation'
  | 'query'
  | 'route'
  | 'scheduled-task'
  | 'serialized-browser-handler'
  | 'webhook';

/** Frozen independently-checkable artifact certificate (Plan 3 §2.1). */
export interface KovoCertificateV1 {
  artifacts: readonly { path: string; sha512: string }[];
  cap: Readonly<Record<string, readonly KovoCertificateCapabilityKind[]>>;
  domain: typeof KOVO_CERTIFICATE_CAPABILITY_DOMAIN;
  doors: readonly {
    escapeId: KovoCertificateCapabilityKind;
    module: string;
    site: string;
  }[];
  edges: readonly (readonly [string, string])[];
  opaque: readonly { module: string; reason: string }[];
  roots: readonly { module: string; rootKind: KovoCertificateRootKind }[];
  schema: 'kovo.certificate/v1';
}

/** One independently-derived checker failure. */
export interface KovoCertificateFinding {
  code: string;
  message: string;
  obligation: 'closure' | 'coverage' | 'schema' | 'stability';
}

/** Source of exact published artifact bytes supplied to the standalone checker. */
export interface KovoCertificateArtifactSource {
  listArtifactPaths(): readonly string[];
  readArtifact(path: string): Uint8Array | undefined;
}

/** Result of checking all three linear certificate obligations. */
export interface KovoCertificateVerificationResult {
  findings: readonly KovoCertificateFinding[];
  ok: boolean;
  stats: {
    artifacts: number;
    capabilities: number;
    doors: number;
    edges: number;
    opaque: number;
    roots: number;
  };
}

/** Verify a certificate without importing Kovo's analyzer or runtime. */
export async function verifyCertificate(
  _certificate: unknown,
  _artifacts: KovoCertificateArtifactSource,
): Promise<KovoCertificateVerificationResult> {
  throw new Error('Plan 3 §2.1 red anchor: standalone certificate checker is not implemented');
}

/** Render a byte-stable human report for the standalone verifier CLI. */
export function formatCertificateVerification(_result: KovoCertificateVerificationResult): string {
  throw new Error('Plan 3 §2.1 red anchor: certificate report is not implemented');
}
