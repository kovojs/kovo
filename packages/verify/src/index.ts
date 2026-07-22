import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'es-module-lexer/js';

/** The nine raw authority kinds certified by `kovo.certificate/v1` (SPEC §6.6). */
export const KOVO_CERTIFICATE_CAPABILITY_DOMAIN = [
  'crypto-acquisition',
  'database-driver',
  'digest',
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
  artifacts: readonly string[];
  cap: Readonly<Record<string, readonly KovoCertificateCapabilityKind[]>>;
  domain: typeof KOVO_CERTIFICATE_CAPABILITY_DOMAIN;
  doors: readonly {
    escapeId: KovoCertificateCapabilityKind;
    module: string;
    site: string;
  }[];
  edges: readonly (readonly [string, string])[];
  opaque: readonly { module: string; reason: string }[];
  policySha512: string;
  roots: readonly { module: string; rootKind: KovoCertificateRootKind }[];
  schema: 'kovo.certificate/v1';
}

/** Independently supplied reviewer policy that owns certificate scope and authority posture. */
export interface KovoCertificatePolicyV1 {
  artifacts: readonly { path: string; sha512: string }[];
  doors: KovoCertificateV1['doors'];
  opaque: KovoCertificateV1['opaque'];
  packages: readonly {
    manifest: Readonly<Record<string, unknown>>;
    name: string;
  }[];
  roots: KovoCertificateV1['roots'];
  schema: 'kovo.certificate-policy/v1';
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
  /** Resolve a first-party package export without consulting Kovo code. */
  resolveArtifactSpecifier?(from: string, specifier: string): string | undefined;
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
  certificateInput: unknown,
  policyBytes: Uint8Array,
  artifacts: KovoCertificateArtifactSource,
): Promise<KovoCertificateVerificationResult> {
  const policySnapshot = Uint8Array.from(policyBytes);
  return await verifyCertificateSnapshot(certificateInput, policySnapshot, artifacts);
}

async function verifyCertificateSnapshot(
  certificateInput: unknown,
  policyBytes: Uint8Array,
  artifacts: KovoCertificateArtifactSource,
): Promise<KovoCertificateVerificationResult> {
  const schemaFindings: KovoCertificateFinding[] = [];
  const certificate = validateCertificate(certificateInput, schemaFindings);
  const policy = validatePolicyBytes(policyBytes, schemaFindings);
  if (certificate === undefined || policy === undefined) {
    return verificationResult(schemaFindings, certificate);
  }

  const policyFindings = compareCertificatePolicy(certificate, policy, policyBytes);
  if (policyFindings.length > 0) return verificationResult(policyFindings, certificate);

  const coverageFindings: KovoCertificateFinding[] = [];
  const artifactPaths = snapshotArtifactPaths(artifacts, coverageFindings);
  const expectedPaths = policy.artifacts.map((entry) => entry.path);
  compareArtifactCoverage(expectedPaths, artifactPaths, coverageFindings);
  compareCapabilityCoverage(certificate, expectedPaths, coverageFindings);
  compareReferencedModuleCoverage(certificate, new Set(expectedPaths), coverageFindings);

  const bytesByPath = new Map<string, Uint8Array>();
  for (const artifact of policy.artifacts) {
    const bytes = snapshotArtifactBytes(artifacts, artifact.path, coverageFindings);
    if (bytes === undefined) continue;
    bytesByPath.set(artifact.path, bytes);
    const actual = sha512(bytes);
    if (actual !== artifact.sha512) {
      coverageFindings.push(
        finding(
          'coverage',
          'artifact-hash',
          `${artifact.path} sha512 mismatch: expected ${artifact.sha512}, observed ${actual}`,
        ),
      );
    }
  }
  if (coverageFindings.length > 0) {
    return verificationResult(coverageFindings, certificate);
  }

  const derivedEdges = new Map<string, readonly [string, string]>();
  const derivedOpaque = new Map<string, { module: string; reason: string }>();
  const localCapabilities = new Map<string, Set<KovoCertificateCapabilityKind>>();
  const artifactSet = new Set(expectedPaths);
  const declaredOpaque = new Set(
    certificate.opaque.map((entry) => `${entry.module}\0${entry.reason}`),
  );
  for (const module of expectedPaths) {
    const bytes = bytesByPath.get(module)!;
    const parsed = parseArtifact(
      module,
      bytes,
      artifactSet,
      artifacts,
      declaredOpaque,
      coverageFindings,
    );
    localCapabilities.set(module, parsed.localCapabilities);
    for (const edge of parsed.edges) derivedEdges.set(tupleKey(edge), edge);
    for (const entry of parsed.opaque) {
      derivedOpaque.set(`${entry.module}\0${entry.reason}`, entry);
    }
  }
  compareEdges(certificate.edges, derivedEdges, coverageFindings);
  compareOpaque(certificate.opaque, derivedOpaque, coverageFindings);
  if (coverageFindings.length > 0) {
    return verificationResult(coverageFindings, certificate);
  }

  const stabilityFindings = checkStability(certificate, localCapabilities);
  if (stabilityFindings.length > 0) {
    return verificationResult(stabilityFindings, certificate);
  }
  return verificationResult(checkClosure(certificate, policy), certificate);
}

/**
 * Verify against regular non-symlink files below an artifact root such as an unpacked
 * `node_modules` directory. Only package dist trees named by the separately supplied policy are
 * enumerated; executable siblings and package entrypoint retargeting fail closed.
 */
export async function verifyCertificateDirectory(
  certificateInput: unknown,
  policyBytes: Uint8Array,
  artifactRoot: string,
): Promise<KovoCertificateVerificationResult> {
  const policySnapshot = Uint8Array.from(policyBytes);
  const findings: KovoCertificateFinding[] = [];
  const certificate = validateCertificate(certificateInput, findings);
  const policy = validatePolicyBytes(policySnapshot, findings);
  if (certificate === undefined || policy === undefined) {
    return verificationResult(findings, certificate);
  }
  const directory = directoryArtifactSource(artifactRoot, policy);
  if (directory.findings.length > 0) {
    return verificationResult(directory.findings, certificate);
  }
  return await verifyCertificateSnapshot(certificate, policySnapshot, directory.source);
}

/** Render a byte-stable human report for the standalone verifier CLI. */
export function formatCertificateVerification(result: KovoCertificateVerificationResult): string {
  const status = result.ok ? 'PASS' : 'FAIL';
  const stats = result.stats;
  const lines = [
    `kovo-verify/v1 ${status} artifacts=${stats.artifacts} edges=${stats.edges} roots=${stats.roots} doors=${stats.doors} opaque=${stats.opaque} capabilities=${stats.capabilities} findings=${result.findings.length}`,
  ];
  for (const entry of result.findings) {
    lines.push(`${entry.obligation.toUpperCase()} ${entry.code} ${entry.message}`);
  }
  return `${lines.join('\n')}\n`;
}

const rootKinds = new Set<KovoCertificateRootKind>([
  'agent-tool-callback',
  'application',
  'durable-task',
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'scheduled-task',
  'serialized-browser-handler',
  'webhook',
]);

const capabilityIndex = new Map<KovoCertificateCapabilityKind, number>(
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN.map((capability, index) => [capability, index]),
);

const rawModuleCapabilities = new Map<string, KovoCertificateCapabilityKind>([
  ['child_process', 'process'],
  ['cloudflare:sockets', 'network'],
  ['cluster', 'process'],
  ['dgram', 'network'],
  ['dns', 'network'],
  ['fs', 'filesystem'],
  ['http', 'network'],
  ['http2', 'network'],
  ['https', 'network'],
  ['inspector', 'process'],
  ['module', 'dynamic-loader'],
  ['net', 'network'],
  ['os', 'process'],
  ['process', 'process'],
  ['readline', 'process'],
  ['repl', 'process'],
  ['sea', 'process'],
  ['tls', 'network'],
  ['trace_events', 'process'],
  ['tty', 'process'],
  ['v8', 'vm'],
  ['vm', 'vm'],
  ['wasi', 'vm'],
  ['worker_threads', 'worker'],
]);

const rawDatabasePackages = new Set([
  '@electric-sql/pglite',
  'better-sqlite3',
  'bun:sqlite',
  'mysql',
  'mysql2',
  'node:sqlite',
  'pg',
  'postgres',
  'sqlite3',
]);

function validateCertificate(
  input: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1 | undefined {
  const record = exactRecord(
    input,
    'certificate',
    ['artifacts', 'cap', 'domain', 'doors', 'edges', 'opaque', 'policySha512', 'roots', 'schema'],
    findings,
  );
  if (record === undefined) return undefined;
  if (record.schema !== 'kovo.certificate/v1') {
    findings.push(finding('schema', 'schema-version', 'schema must equal kovo.certificate/v1'));
  }
  validateDomain(record.domain, findings);
  const artifacts = validateArtifacts(record.artifacts, findings);
  const cap = validateCapabilityMap(record.cap, findings);
  const edges = validateEdges(record.edges, findings);
  const roots = validateRoots(record.roots, findings);
  const doors = validateDoors(record.doors, findings);
  const opaque = validateOpaque(record.opaque, findings);
  if (!isSha512(record.policySha512)) {
    findings.push(
      finding('schema', 'policy-sha512', 'policySha512 must be a canonical sha512 integrity'),
    );
  }
  if (
    findings.length > 0 ||
    artifacts === undefined ||
    cap === undefined ||
    edges === undefined ||
    roots === undefined ||
    doors === undefined ||
    opaque === undefined
  ) {
    return undefined;
  }
  return {
    artifacts,
    cap,
    domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
    doors,
    edges,
    opaque,
    policySha512: record.policySha512 as string,
    roots,
    schema: 'kovo.certificate/v1',
  };
}

function validatePolicyBytes(
  input: Uint8Array,
  findings: KovoCertificateFinding[],
): KovoCertificatePolicyV1 | undefined {
  if (!(input instanceof Uint8Array)) {
    findings.push(finding('schema', 'policy-bytes', 'policy must be supplied as exact bytes'));
    return undefined;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(input));
  } catch {
    findings.push(finding('schema', 'policy-utf8', 'policy bytes must be valid UTF-8'));
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    findings.push(finding('schema', 'policy-json', 'policy bytes must contain valid JSON'));
    return undefined;
  }
  const policy = validatePolicy(parsed, findings);
  if (policy === undefined) return undefined;
  if (text !== stablePolicyJson(policy)) {
    findings.push(
      finding(
        'schema',
        'policy-noncanonical',
        'policy bytes must equal the canonical two-space JSON encoding with one trailing newline',
      ),
    );
    return undefined;
  }
  return policy;
}

function validatePolicy(
  input: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificatePolicyV1 | undefined {
  const record = exactRecord(
    input,
    'policy',
    ['artifacts', 'doors', 'opaque', 'packages', 'roots', 'schema'],
    findings,
  );
  if (record === undefined) return undefined;
  if (record.schema !== 'kovo.certificate-policy/v1') {
    findings.push(
      finding('schema', 'policy-schema', 'policy schema must equal kovo.certificate-policy/v1'),
    );
  }
  const artifacts = validatePolicyArtifacts(record.artifacts, findings);
  const doors = validateDoors(record.doors, findings);
  const opaque = validateOpaque(record.opaque, findings);
  const artifactSet = new Set(artifacts?.map((entry) => entry.path) ?? []);
  const packages = validatePolicyPackages(record.packages, artifactSet, findings);
  const roots = validateRoots(record.roots, findings);
  if (
    artifacts === undefined ||
    doors === undefined ||
    opaque === undefined ||
    packages === undefined ||
    roots === undefined
  ) {
    return undefined;
  }
  const artifactPackages = [
    ...new Set(artifacts.map((artifact) => packageNameFromArtifact(artifact.path))),
  ].sort(compareStrings);
  const policyPackages = packages.map((entry) => entry.name);
  if (!sameValues(artifactPackages, policyPackages)) {
    findings.push(
      finding(
        'schema',
        'policy-package-scope',
        'policy packages must exactly equal the package set named by policy artifacts',
      ),
    );
  }
  for (const row of [...roots, ...doors, ...opaque]) {
    if (!artifactSet.has(row.module)) {
      findings.push(
        finding('schema', 'policy-module-unlisted', `${row.module} is outside policy artifacts`),
      );
    }
  }
  if (findings.length > 0) return undefined;
  return {
    artifacts,
    doors,
    opaque,
    packages,
    roots,
    schema: 'kovo.certificate-policy/v1',
  };
}

function validatePolicyArtifacts(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificatePolicyV1['artifacts'] | undefined {
  const values = denseArray(value, 'policy.artifacts', findings);
  if (values === undefined) return undefined;
  const artifacts: { path: string; sha512: string }[] = [];
  for (const [index, item] of values.entries()) {
    const row = exactRecord(item, `policy.artifacts[${index}]`, ['path', 'sha512'], findings);
    if (row === undefined || !isCanonicalArtifactPath(row.path) || !isSha512(row.sha512)) {
      findings.push(
        finding(
          'schema',
          'policy-artifact',
          `policy.artifacts[${index}] must contain a canonical path and sha512`,
        ),
      );
      continue;
    }
    artifacts.push({ path: row.path, sha512: row.sha512 });
  }
  if (artifacts.length === 0) {
    findings.push(
      finding('schema', 'policy-artifacts', 'policy.artifacts must be a non-empty array'),
    );
  }
  validateSortedUnique(artifacts, (entry) => entry.path, 'policy.artifacts', findings);
  return artifacts;
}

function validatePolicyPackages(
  value: unknown,
  artifactSet: ReadonlySet<string>,
  findings: KovoCertificateFinding[],
): KovoCertificatePolicyV1['packages'] | undefined {
  const values = denseArray(value, 'policy.packages', findings);
  if (values === undefined) return undefined;
  const packages: KovoCertificatePolicyV1['packages'][number][] = [];
  for (const [index, item] of values.entries()) {
    const label = `policy.packages[${index}]`;
    const row = exactRecord(item, label, ['manifest', 'name'], findings);
    if (row === undefined) continue;
    if (!isCanonicalPackageName(row.name)) {
      findings.push(finding('schema', 'policy-package', `${label}.name is invalid`));
      continue;
    }
    const manifest = snapshotJsonRecord(row.manifest, `${label}.manifest`, findings);
    if (manifest === undefined) continue;
    if (manifest.name !== row.name || Object.hasOwn(manifest, 'publishConfig')) {
      findings.push(
        finding(
          'schema',
          'policy-manifest',
          `${label}.manifest must have the exact package name and no publishConfig`,
        ),
      );
      continue;
    }
    try {
      for (const target of packageManifestRuntimeTargets(manifest, row.name)) {
        if (!artifactSet.has(target)) {
          findings.push(
            finding(
              'schema',
              'policy-entrypoint-unlisted',
              `${row.name} runtime target ${target} is outside policy artifacts`,
            ),
          );
        }
      }
    } catch (error) {
      findings.push(
        finding(
          'schema',
          'policy-manifest-entrypoint',
          `${label}.manifest is unsupported: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
      );
    }
    packages.push({ manifest, name: row.name });
  }
  validateSortedUnique(packages, (entry) => entry.name, 'policy.packages', findings);
  if (packages.length === 0) {
    findings.push(finding('schema', 'policy-packages', 'policy.packages must be non-empty'));
  }
  return packages;
}

function compareCertificatePolicy(
  certificate: KovoCertificateV1,
  policy: KovoCertificatePolicyV1,
  policyBytes: Uint8Array,
): KovoCertificateFinding[] {
  const findings: KovoCertificateFinding[] = [];
  const actualPolicySha512 = sha512(policyBytes);
  if (certificate.policySha512 !== actualPolicySha512) {
    findings.push(
      finding(
        'coverage',
        'policy-hash',
        `certificate policySha512 mismatch: expected ${certificate.policySha512}, observed ${actualPolicySha512}`,
      ),
    );
  }
  const policyArtifacts = policy.artifacts.map((entry) => entry.path);
  if (!sameValues(certificate.artifacts, policyArtifacts)) {
    findings.push(
      finding(
        'coverage',
        'policy-artifact-scope',
        'certificate artifacts must exactly equal reviewer policy artifacts',
      ),
    );
  }
  if (JSON.stringify(certificate.roots) !== JSON.stringify(policy.roots)) {
    findings.push(
      finding(
        'closure',
        'policy-roots',
        'certificate roots must exactly equal reviewer policy roots',
      ),
    );
  }
  if (JSON.stringify(certificate.doors) !== JSON.stringify(policy.doors)) {
    findings.push(
      finding(
        'closure',
        'policy-doors',
        'certificate doors must exactly equal reviewer policy doors',
      ),
    );
  }
  if (JSON.stringify(certificate.opaque) !== JSON.stringify(policy.opaque)) {
    findings.push(
      finding(
        'coverage',
        'policy-opaque',
        'certificate opaque assumptions must exactly equal reviewer policy opaque assumptions',
      ),
    );
  }
  return findings.sort(compareFindings);
}

function stablePolicyJson(policy: KovoCertificatePolicyV1): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

function validateDomain(value: unknown, findings: KovoCertificateFinding[]): void {
  const values = denseArray(value, 'domain', findings);
  if (
    values === undefined ||
    values.length !== KOVO_CERTIFICATE_CAPABILITY_DOMAIN.length ||
    !KOVO_CERTIFICATE_CAPABILITY_DOMAIN.every((capability, index) => values[index] === capability)
  ) {
    findings.push(
      finding(
        'schema',
        'domain',
        `domain must equal ${KOVO_CERTIFICATE_CAPABILITY_DOMAIN.join(',')}`,
      ),
    );
  }
}

function validateArtifacts(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['artifacts'] | undefined {
  const values = denseArray(value, 'artifacts', findings);
  if (values === undefined) return undefined;
  const artifacts: string[] = [];
  for (const [index, item] of values.entries()) {
    if (!isCanonicalArtifactPath(item)) {
      findings.push(
        finding(
          'schema',
          'artifact-path',
          `artifacts[${index}] must be canonical @kovojs/*/dist/*.mjs`,
        ),
      );
      continue;
    }
    artifacts.push(item);
  }
  validateSortedUnique(artifacts, (entry) => entry, 'artifacts', findings);
  return artifacts;
}

function validateCapabilityMap(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['cap'] | undefined {
  const record = dataRecord(value, 'cap', findings);
  if (record === undefined) return undefined;
  const keys = Object.keys(record);
  if (!sameValues(keys, [...keys].sort(compareStrings))) {
    findings.push(finding('schema', 'cap-order', 'cap module keys must be sorted'));
  }
  const cap: Record<string, readonly KovoCertificateCapabilityKind[]> = {};
  for (const module of keys) {
    if (!isCanonicalArtifactPath(module)) {
      findings.push(
        finding('schema', 'cap-module', `cap key ${JSON.stringify(module)} is not canonical`),
      );
      continue;
    }
    const values = denseArray(record[module], `cap[${JSON.stringify(module)}]`, findings);
    if (values === undefined) continue;
    const capabilities = values.filter(isCapability);
    if (capabilities.length !== values.length) {
      findings.push(
        finding(
          'schema',
          'cap-kind',
          `cap[${JSON.stringify(module)}] contains an unknown capability`,
        ),
      );
      continue;
    }
    if (
      !sameValues(capabilities, sortCapabilities(capabilities)) ||
      new Set(capabilities).size !== capabilities.length
    ) {
      findings.push(
        finding('schema', 'cap-order', `cap[${JSON.stringify(module)}] must be sorted and unique`),
      );
    }
    cap[module] = capabilities;
  }
  return cap;
}

function validateEdges(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['edges'] | undefined {
  const values = denseArray(value, 'edges', findings);
  if (values === undefined) return undefined;
  const rows: (readonly [string, string])[] = [];
  for (const [index, item] of values.entries()) {
    const tuple = denseArray(item, `edges[${index}]`, findings);
    if (
      tuple === undefined ||
      tuple.length !== 2 ||
      !isCanonicalArtifactPath(tuple[0]) ||
      !isCanonicalArtifactPath(tuple[1])
    ) {
      findings.push(
        finding('schema', 'edge', `edges[${index}] must contain two canonical module paths`),
      );
      continue;
    }
    rows.push([tuple[0], tuple[1]]);
  }
  validateSortedUnique(rows, tupleKey, 'edges', findings);
  return rows;
}

function validateRoots(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['roots'] | undefined {
  const values = denseArray(value, 'roots', findings);
  if (values === undefined) return undefined;
  const rows: { module: string; rootKind: KovoCertificateRootKind }[] = [];
  for (const [index, item] of values.entries()) {
    const row = exactRecord(item, `roots[${index}]`, ['module', 'rootKind'], findings);
    if (
      row === undefined ||
      !isCanonicalArtifactPath(row.module) ||
      typeof row.rootKind !== 'string' ||
      !rootKinds.has(row.rootKind as KovoCertificateRootKind)
    ) {
      findings.push(finding('schema', 'root', `roots[${index}] has an invalid module or rootKind`));
      continue;
    }
    rows.push({ module: row.module, rootKind: row.rootKind as KovoCertificateRootKind });
  }
  validateSortedUnique(rows, (row) => `${row.module}\0${row.rootKind}`, 'roots', findings);
  return rows;
}

function validateDoors(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['doors'] | undefined {
  const values = denseArray(value, 'doors', findings);
  if (values === undefined) return undefined;
  const rows: {
    escapeId: KovoCertificateCapabilityKind;
    module: string;
    site: string;
  }[] = [];
  for (const [index, item] of values.entries()) {
    const row = exactRecord(item, `doors[${index}]`, ['escapeId', 'module', 'site'], findings);
    if (
      row === undefined ||
      !isCapability(row.escapeId) ||
      !isCanonicalArtifactPath(row.module) ||
      !isNonemptyText(row.site)
    ) {
      findings.push(finding('schema', 'door', `doors[${index}] has invalid fields`));
      continue;
    }
    rows.push({ escapeId: row.escapeId, module: row.module, site: row.site });
  }
  validateSortedUnique(
    rows,
    (row) => `${row.module}\0${row.escapeId}\0${row.site}`,
    'doors',
    findings,
  );
  return rows;
}

function validateOpaque(
  value: unknown,
  findings: KovoCertificateFinding[],
): KovoCertificateV1['opaque'] | undefined {
  const values = denseArray(value, 'opaque', findings);
  if (values === undefined) return undefined;
  const rows: { module: string; reason: string }[] = [];
  for (const [index, item] of values.entries()) {
    const row = exactRecord(item, `opaque[${index}]`, ['module', 'reason'], findings);
    if (row === undefined || !isCanonicalArtifactPath(row.module) || !isNonemptyText(row.reason)) {
      findings.push(finding('schema', 'opaque', `opaque[${index}] has invalid fields`));
      continue;
    }
    rows.push({ module: row.module, reason: row.reason });
  }
  validateSortedUnique(rows, (row) => `${row.module}\0${row.reason}`, 'opaque', findings);
  return rows;
}

function exactRecord(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
  findings: KovoCertificateFinding[],
): Record<string, unknown> | undefined {
  const record = dataRecord(value, label, findings);
  if (record === undefined) return undefined;
  const actual = Object.keys(record).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  if (!sameValues(actual, expected)) {
    findings.push(
      finding(
        'schema',
        'record-keys',
        `${label} keys must equal ${expected.join(',')}; got ${actual.join(',')}`,
      ),
    );
    return undefined;
  }
  return record;
}

function dataRecord(
  value: unknown,
  label: string,
  findings: KovoCertificateFinding[],
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    findings.push(finding('schema', 'record', `${label} must be an own-data object`));
    return undefined;
  }
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      findings.push(finding('schema', 'record-prototype', `${label} must use Object.prototype`));
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) {
      findings.push(finding('schema', 'record-symbol', `${label} must not have symbol keys`));
      return undefined;
    }
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        !('value' in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        findings.push(finding('schema', 'record-accessor', `${label}.${key} must be own data`));
        return undefined;
      }
    }
    return Object.fromEntries((keys as string[]).map((key) => [key, descriptors[key]!.value]));
  } catch {
    findings.push(finding('schema', 'record-trap', `${label} could not be snapshotted`));
    return undefined;
  }
}

function denseArray(
  value: unknown,
  label: string,
  findings: KovoCertificateFinding[],
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    findings.push(finding('schema', 'array', `${label} must be a dense array`));
    return undefined;
  }
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      findings.push(finding('schema', 'array-prototype', `${label} must use Array.prototype`));
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
      findings.push(finding('schema', 'array-length', `${label}.length must be own data`));
      return undefined;
    }
    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      findings.push(finding('schema', 'array-length', `${label}.length must be a safe integer`));
      return undefined;
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !('value' in descriptor)) {
        findings.push(finding('schema', 'array-density', `${label}[${index}] must be own data`));
        return undefined;
      }
      output.push(descriptor.value);
    }
    const expectedKeys = new Set(['length', ...output.map((_, index) => String(index))]);
    if (Reflect.ownKeys(descriptors).some((key) => !expectedKeys.has(key as string))) {
      findings.push(finding('schema', 'array-property', `${label} has an unexpected property`));
      return undefined;
    }
    return output;
  } catch {
    findings.push(finding('schema', 'array-trap', `${label} could not be snapshotted`));
    return undefined;
  }
}

function snapshotJsonRecord(
  value: unknown,
  label: string,
  findings: KovoCertificateFinding[],
): Record<string, unknown> | undefined {
  const snapshotted = snapshotJsonValue(value, label, findings, 0);
  return isPlainJsonRecord(snapshotted) ? snapshotted : undefined;
}

function snapshotJsonValue(
  value: unknown,
  label: string,
  findings: KovoCertificateFinding[],
  depth: number,
): unknown {
  if (depth > 64) {
    findings.push(finding('schema', 'json-depth', `${label} exceeds the JSON depth limit`));
    return undefined;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const values = denseArray(value, label, findings);
    return values?.map((entry, index) =>
      snapshotJsonValue(entry, `${label}[${index}]`, findings, depth + 1),
    );
  }
  const record = dataRecord(value, label, findings);
  if (record === undefined) {
    findings.push(finding('schema', 'json-value', `${label} must contain only JSON data`));
    return undefined;
  }
  return Object.fromEntries(
    Object.keys(record).map((key) => [
      key,
      snapshotJsonValue(record[key], `${label}.${key}`, findings, depth + 1),
    ]),
  );
}

function validateSortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
  findings: KovoCertificateFinding[],
): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length || !sameValues(keys, [...keys].sort(compareStrings))) {
    findings.push(finding('schema', 'row-order', `${label} must be sorted and unique`));
  }
}

function directoryArtifactSource(
  artifactRoot: string,
  policy: KovoCertificatePolicyV1,
): { findings: KovoCertificateFinding[]; source: KovoCertificateArtifactSource } {
  const findings: KovoCertificateFinding[] = [];
  let root = path.resolve(artifactRoot);
  const modulePaths: string[] = [];
  const moduleBytes = new Map<string, Uint8Array>();
  try {
    root = realpathSync(root);
    const actualPackages = listKovoPackageNames(root);
    const policyPackages = policy.packages.map((entry) => entry.name);
    comparePackageCoverage(policyPackages, actualPackages, findings);
    const packageByName = new Map(policy.packages.map((entry) => [entry.name, entry]));
    for (const packageName of policyPackages) {
      const packagePolicy = packageByName.get(packageName)!;
      const manifestPath = checkedPath(root, `${packageName}/package.json`, 'file');
      try {
        const manifest = parsePackageManifest(readFileSync(manifestPath, 'utf8'), packageName);
        comparePackagePolicy(packagePolicy, manifest, findings);
      } catch (error) {
        findings.push(
          finding(
            'coverage',
            'manifest-invalid',
            `${packageName}/package.json is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
          ),
        );
      }
      const dist = checkedPath(root, `${packageName}/dist`, 'directory');
      collectModuleFiles(root, dist, `${packageName}/dist`, modulePaths, findings);
    }
    for (const modulePath of modulePaths) {
      moduleBytes.set(
        modulePath,
        Uint8Array.from(readFileSync(checkedPath(root, modulePath, 'file'))),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        'coverage',
        'artifact-list',
        `artifact directory could not be enumerated: ${error instanceof Error ? error.message : 'unknown error'}`,
      ),
    );
  }
  const paths = modulePaths.sort(compareStrings);
  return {
    findings: findings.sort(compareFindings),
    source: {
      listArtifactPaths: () => paths,
      readArtifact(artifactPath) {
        const bytes = moduleBytes.get(artifactPath);
        return bytes === undefined ? undefined : Uint8Array.from(bytes);
      },
      resolveArtifactSpecifier(_from, specifier) {
        return resolvePolicyPackageSpecifier(policy, specifier);
      },
    },
  };
}

function parsePackageManifest(text: string, packageName: string): Record<string, unknown> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError('manifest is not valid JSON');
  }
  if (!isPlainJsonRecord(manifest) || manifest.name !== packageName) {
    throw new TypeError(`manifest name must equal ${packageName}`);
  }
  if (Object.hasOwn(manifest, 'publishConfig')) {
    throw new TypeError('installed manifest must not contain publishConfig resolver overrides');
  }
  assertJsonValue(manifest, `${packageName} package manifest`);
  packageManifestRuntimeTargets(manifest, packageName);
  return manifest;
}

function packageManifestRuntimeTargets(
  manifest: Record<string, unknown>,
  packageName: string,
): Set<string> {
  const targets = new Set<string>();
  if (manifest.exports !== undefined) {
    const exportsMap = checkerPackageExports(manifest.exports);
    for (const subpath of Object.keys(exportsMap)) {
      if (!isCanonicalExportSubpath(subpath)) {
        throw new TypeError(`exports contains unsupported subpath ${JSON.stringify(subpath)}`);
      }
      targets.add(
        packageManifestTarget(
          singleManifestRuntimeTarget(exportsMap[subpath], `exports ${JSON.stringify(subpath)}`),
          packageName,
        ),
      );
    }
  }
  for (const target of packageManifestBinTargets(manifest.bin, packageName)) targets.add(target);
  for (const field of ['main', 'module'] as const) {
    if (manifest[field] === undefined) continue;
    if (typeof manifest[field] !== 'string') {
      throw new TypeError(`${field} must be a string when present`);
    }
    targets.add(packageManifestTarget(manifest[field], packageName));
  }
  return targets;
}

function collectManifestRuntimeTargets(value: unknown): Set<string> {
  if (typeof value === 'string') return new Set([value]);
  if (Array.isArray(value)) {
    const targets = new Set<string>();
    for (const entry of value) {
      for (const target of collectManifestRuntimeTargets(entry)) targets.add(target);
    }
    return targets;
  }
  if (!isPlainJsonRecord(value)) return new Set();
  const targets = new Set<string>();
  for (const key of Object.keys(value)) {
    if (key === 'types' || key.startsWith('types@')) continue;
    for (const target of collectManifestRuntimeTargets(value[key])) targets.add(target);
  }
  return targets;
}

function singleManifestRuntimeTarget(value: unknown, label: string): string {
  const targets = [...collectManifestRuntimeTargets(value)];
  if (targets.length !== 1) {
    throw new TypeError(
      `${label} must collapse every runtime condition and fallback to one target`,
    );
  }
  return targets[0]!;
}

function packageManifestBinTargets(value: unknown, packageName: string): readonly string[] {
  if (value === undefined) return [];
  const entries =
    typeof value === 'string'
      ? [[packageName.slice(packageName.indexOf('/') + 1), value] as const]
      : isPlainJsonRecord(value)
        ? Object.entries(value).sort(([left], [right]) => compareStrings(left, right))
        : undefined;
  if (entries === undefined) throw new TypeError('bin must be a string or a plain object');
  return entries.map(([name, target]) => {
    if (!isNonemptyText(name) || typeof target !== 'string') {
      throw new TypeError('bin names and targets must be non-empty strings');
    }
    return packageManifestTarget(target, packageName);
  });
}

function packageManifestTarget(value: string, packageName: string): string {
  if (
    !value.startsWith('./dist/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    path.posix.normalize(value) !== value.slice(2) ||
    !value.endsWith('.mjs')
  ) {
    throw new TypeError(
      `runtime entrypoint ${JSON.stringify(value)} must be a canonical ./dist/*.mjs target`,
    );
  }
  return `${packageName}/${value.slice(2)}`;
}

function assertJsonValue(value: unknown, label: string): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertJsonValue(entry, `${label}[${index}]`);
    return;
  }
  if (isPlainJsonRecord(value)) {
    for (const [key, entry] of Object.entries(value)) assertJsonValue(entry, `${label}.${key}`);
    return;
  }
  throw new TypeError(`${label} must contain only JSON data`);
}

function isReviewedNonRuntimeDistPath(value: string): boolean {
  return /(?:\.d\.(?:cts|mts|ts)|\.(?:d\.(?:cts|mts|ts)|mjs)\.map)$/u.test(value);
}

function executableDistPath(value: string): boolean {
  const base = path.posix.basename(value);
  return /\.(?:cjs|js|node|wasm)$/u.test(base) || !base.includes('.');
}

function listKovoPackageNames(root: string): string[] {
  const scope = checkedPath(root, '@kovojs', 'directory');
  const packages: string[] = [];
  for (const entry of readdirSync(scope, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name, right.name),
  )) {
    const relativePath = `@kovojs/${entry.name}`;
    const absolutePath = path.join(scope, entry.name);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new TypeError(`artifact package contains a symlink: ${relativePath}`);
    }
    if (!stat.isDirectory() || !isCanonicalPackageName(relativePath)) {
      throw new TypeError(`artifact package scope contains an unsupported entry: ${relativePath}`);
    }
    ensureInsideRoot(root, realpathSync(absolutePath), relativePath);
    packages.push(relativePath);
  }
  return packages;
}

function comparePackageCoverage(
  expected: readonly string[],
  actual: readonly string[],
  findings: KovoCertificateFinding[],
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const packageName of expected) {
    if (!actualSet.has(packageName)) {
      findings.push(
        finding('coverage', 'package-missing', `${packageName} is absent from artifact root`),
      );
    }
  }
  for (const packageName of actual) {
    if (!expectedSet.has(packageName)) {
      findings.push(
        finding(
          'coverage',
          'package-unlisted',
          `${packageName} is installed but absent from reviewer policy`,
        ),
      );
    }
  }
}

function comparePackagePolicy(
  expected: KovoCertificatePolicyV1['packages'][number],
  actualManifest: Readonly<Record<string, unknown>>,
  findings: KovoCertificateFinding[],
): void {
  if (JSON.stringify(expected.manifest) !== JSON.stringify(actualManifest)) {
    findings.push(
      finding(
        'coverage',
        'manifest-mismatch',
        `${expected.name}/package.json differs from the exact reviewer-owned installed manifest`,
      ),
    );
  }
}

function collectModuleFiles(
  root: string,
  directory: string,
  relativeDirectory: string,
  output: string[],
  findings: KovoCertificateFinding[],
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name, right.name),
  )) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const absolutePath = path.join(directory, entry.name);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new TypeError(`artifact path contains a symlink: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      collectModuleFiles(root, absolutePath, relativePath, output, findings);
    } else if (stat.isFile() && relativePath.endsWith('.mjs')) {
      ensureInsideRoot(root, realpathSync(absolutePath), relativePath);
      output.push(relativePath);
    } else if (stat.isFile() && isReviewedNonRuntimeDistPath(relativePath)) {
      ensureInsideRoot(root, realpathSync(absolutePath), relativePath);
    } else if (stat.isFile()) {
      ensureInsideRoot(root, realpathSync(absolutePath), relativePath);
      findings.push(
        finding(
          'coverage',
          executableDistPath(relativePath)
            ? 'unsupported-executable-artifact'
            : 'unsupported-dist-artifact',
          `${relativePath} is not a reviewed non-runtime declaration or source-map artifact`,
        ),
      );
    } else {
      throw new TypeError(`artifact dist contains an unsupported entry: ${relativePath}`);
    }
  }
}

function checkedPath(root: string, relativePath: string, expected: 'directory' | 'file'): string {
  if (!isCanonicalRelativePath(relativePath)) {
    throw new TypeError(`artifact path is not canonical: ${relativePath}`);
  }
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new TypeError(`artifact path contains a symlink: ${relativePath}`);
    }
  }
  const stat = lstatSync(current);
  if (expected === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
    throw new TypeError(`artifact path is not a regular ${expected}: ${relativePath}`);
  }
  ensureInsideRoot(root, realpathSync(current), relativePath);
  return current;
}

function ensureInsideRoot(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError(`artifact path escapes its root: ${label}`);
  }
}

function isCanonicalRelativePath(value: string): boolean {
  return (
    value !== '' &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value &&
    !value.split('/').includes('..')
  );
}

function snapshotArtifactPaths(
  artifacts: KovoCertificateArtifactSource,
  findings: KovoCertificateFinding[],
): readonly string[] {
  try {
    const listed = artifacts.listArtifactPaths();
    if (!Array.isArray(listed)) throw new TypeError('artifact list is not an array');
    const output = [...listed];
    if (output.some((entry) => !isCanonicalArtifactPath(entry))) {
      findings.push(
        finding('coverage', 'artifact-list-path', 'artifact source returned a non-canonical path'),
      );
    }
    if (new Set(output).size !== output.length) {
      findings.push(
        finding('coverage', 'artifact-list-duplicate', 'artifact source returned duplicate paths'),
      );
    }
    return output.sort(compareStrings);
  } catch {
    findings.push(finding('coverage', 'artifact-list', 'artifact source list could not be read'));
    return [];
  }
}

function snapshotArtifactBytes(
  artifacts: KovoCertificateArtifactSource,
  artifactPath: string,
  findings: KovoCertificateFinding[],
): Uint8Array | undefined {
  try {
    const value = artifacts.readArtifact(artifactPath);
    if (!(value instanceof Uint8Array)) {
      findings.push(finding('coverage', 'artifact-missing', `${artifactPath} bytes are missing`));
      return undefined;
    }
    return Uint8Array.from(value);
  } catch {
    findings.push(finding('coverage', 'artifact-read', `${artifactPath} bytes could not be read`));
    return undefined;
  }
}

function compareArtifactCoverage(
  expected: readonly string[],
  actual: readonly string[],
  findings: KovoCertificateFinding[],
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const module of expected) {
    if (!actualSet.has(module)) {
      findings.push(finding('coverage', 'artifact-missing', `${module} is absent`));
    }
  }
  for (const module of actual) {
    if (!expectedSet.has(module)) {
      findings.push(finding('coverage', 'artifact-unlisted', `${module} is unlisted`));
    }
  }
}

function compareCapabilityCoverage(
  certificate: KovoCertificateV1,
  artifactPaths: readonly string[],
  findings: KovoCertificateFinding[],
): void {
  const capPaths = Object.keys(certificate.cap);
  if (sameValues(capPaths, artifactPaths)) return;
  const capSet = new Set(capPaths);
  const artifactSet = new Set(artifactPaths);
  for (const module of artifactPaths) {
    if (!capSet.has(module)) {
      findings.push(finding('coverage', 'cap-missing', `${module} has no cap summary`));
    }
  }
  for (const module of capPaths) {
    if (!artifactSet.has(module)) {
      findings.push(finding('coverage', 'cap-unlisted', `${module} cap has no artifact`));
    }
  }
}

function compareReferencedModuleCoverage(
  certificate: KovoCertificateV1,
  artifacts: ReadonlySet<string>,
  findings: KovoCertificateFinding[],
): void {
  for (const [from, to] of certificate.edges) {
    if (!artifacts.has(from) || !artifacts.has(to)) {
      findings.push(
        finding('coverage', 'edge-module-unlisted', `${from} -> ${to} names an unlisted artifact`),
      );
    }
  }
  for (const root of certificate.roots) {
    if (!artifacts.has(root.module)) {
      findings.push(finding('coverage', 'root-module-unlisted', `${root.module} root is unlisted`));
    }
  }
  for (const door of certificate.doors) {
    if (!artifacts.has(door.module)) {
      findings.push(finding('coverage', 'door-module-unlisted', `${door.module} door is unlisted`));
    }
  }
  for (const opaque of certificate.opaque) {
    if (!artifacts.has(opaque.module)) {
      findings.push(finding('coverage', 'opaque-module-unlisted', `${opaque.module} is unlisted`));
    }
  }
}

function parseArtifact(
  module: string,
  bytes: Uint8Array,
  artifacts: ReadonlySet<string>,
  artifactSource: KovoCertificateArtifactSource,
  declaredOpaque: ReadonlySet<string>,
  findings: KovoCertificateFinding[],
): {
  edges: readonly (readonly [string, string])[];
  localCapabilities: Set<KovoCertificateCapabilityKind>;
  opaque: readonly { module: string; reason: string }[];
} {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    findings.push(finding('coverage', 'artifact-utf8', `${module} is not valid UTF-8`));
    return { edges: [], localCapabilities: new Set(), opaque: [] };
  }
  let imports: ReturnType<typeof parse>[0];
  try {
    [imports] = parse(source, module);
  } catch (error) {
    findings.push(
      finding(
        'coverage',
        'artifact-parse',
        `${module} parse failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      ),
    );
    return { edges: [], localCapabilities: new Set(), opaque: [] };
  }
  const edges = new Map<string, readonly [string, string]>();
  const localCapabilities = new Set<KovoCertificateCapabilityKind>();
  const opaque = new Map<string, { module: string; reason: string }>();
  for (const imported of imports) {
    if (imported.d === -2 || imported.t === 3) continue;
    const specifier = imported.n;
    if (specifier === undefined) {
      const entry = {
        module,
        reason:
          'contains computed dynamic import; runtime-selected dependency loads require §4.6 lexical authority coverage',
      };
      const key = `${entry.module}\0${entry.reason}`;
      opaque.set(key, entry);
      if (!declaredOpaque.has(key)) {
        findings.push(
          finding(
            'coverage',
            'computed-import',
            `${module} contains an unledgered computed dynamic import`,
          ),
        );
      }
      continue;
    }
    if (specifier === 'node:module' || specifier === 'module') {
      const entry = {
        module,
        reason:
          'imports Node module-loader authority; runtime-selected dependency loads require lexical authority coverage',
      };
      opaque.set(`${entry.module}\0${entry.reason}`, entry);
    }
    const capability = classifyRawCapabilityImport(source, imported, specifier);
    if (capability !== undefined) {
      localCapabilities.add(capability);
      continue;
    }
    if (unsupportedModuleSpecifier(specifier)) {
      findings.push(
        finding(
          'coverage',
          'unsupported-import',
          `${module} imports unsupported module specifier ${JSON.stringify(specifier)}`,
        ),
      );
      continue;
    }
    if (specifier.endsWith('.node') || specifier.endsWith('.wasm')) {
      findings.push(
        finding(
          'coverage',
          'native-or-wasm-import',
          `${module} imports unsupported ${JSON.stringify(specifier)}`,
        ),
      );
      continue;
    }
    const target = resolveArtifactSpecifier(module, specifier, artifactSource);
    if (target === undefined) {
      if (specifier.startsWith('@kovojs/')) {
        findings.push(
          finding(
            'coverage',
            'edge-unresolved',
            `${module} first-party import ${JSON.stringify(specifier)} is unresolved`,
          ),
        );
      } else {
        const entry = { module, reason: externalOpaqueReason(specifier) };
        opaque.set(`${entry.module}\0${entry.reason}`, entry);
      }
      continue;
    }
    if (!artifacts.has(target)) {
      findings.push(
        finding(
          'coverage',
          'edge-unresolved',
          `${module} import ${JSON.stringify(specifier)} does not resolve to ${target}`,
        ),
      );
      continue;
    }
    const edge = [module, target] as const;
    edges.set(tupleKey(edge), edge);
  }
  return {
    edges: [...edges.values()].sort(compareTuples),
    localCapabilities,
    opaque: [...opaque.values()].sort((left, right) =>
      compareStrings(`${left.module}\0${left.reason}`, `${right.module}\0${right.reason}`),
    ),
  };
}

function resolveArtifactSpecifier(
  module: string,
  specifier: string,
  artifacts: KovoCertificateArtifactSource,
): string | undefined {
  if (specifier.startsWith('.')) {
    if (specifier.includes('\\') || specifier.includes('?') || specifier.includes('#')) {
      return undefined;
    }
    return path.posix.normalize(path.posix.join(path.posix.dirname(module), specifier));
  }
  if (specifier.startsWith('@kovojs/')) {
    if (artifacts.resolveArtifactSpecifier !== undefined) {
      const resolved = artifacts.resolveArtifactSpecifier(module, specifier);
      return resolved !== undefined && isCanonicalArtifactPath(resolved) ? resolved : undefined;
    }
    const parts = specifier.split('/');
    if (parts.length < 2) return undefined;
    const packageName = `${parts[0]}/${parts[1]}`;
    const subpath = parts.slice(2);
    return subpath.length === 0
      ? `${packageName}/dist/index.mjs`
      : `${packageName}/dist/${subpath.join('/')}.mjs`;
  }
  return undefined;
}

function unsupportedModuleSpecifier(specifier: string): boolean {
  return (
    specifier === '' ||
    specifier.includes('\\') ||
    specifier.includes('?') ||
    specifier.includes('#') ||
    specifier.startsWith('/') ||
    (/^[a-z][a-z+.-]*:/iu.test(specifier) && !specifier.startsWith('node:'))
  );
}

function externalOpaqueReason(specifier: string): string {
  return `imports external module ${JSON.stringify(specifier)} outside the nine-kind lexical capability domain`;
}

function resolvePolicyPackageSpecifier(
  policy: KovoCertificatePolicyV1,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('@kovojs/')) return undefined;
  const parts = specifier.split('/');
  if (parts.length < 2) return undefined;
  const packageName = `${parts[0]}/${parts[1]}`;
  const subpath = parts.length === 2 ? '.' : `./${parts.slice(2).join('/')}`;
  const manifest = policy.packages.find((entry) => entry.name === packageName)?.manifest;
  if (manifest === undefined) return undefined;
  try {
    const exportsMap = checkerPackageExports(manifest.exports);
    const target = singleManifestRuntimeTarget(
      exportsMap[subpath],
      `${packageName} export ${JSON.stringify(subpath)}`,
    );
    return packageManifestTarget(target, packageName);
  } catch {
    return undefined;
  }
}

function checkerPackageExports(value: unknown): Record<string, unknown> {
  if (!isPlainJsonRecord(value)) return { '.': value };
  return Object.keys(value).some((key) => key === '.' || key.startsWith('./'))
    ? value
    : { '.': value };
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function compareEdges(
  declared: readonly (readonly [string, string])[],
  derived: ReadonlyMap<string, readonly [string, string]>,
  findings: KovoCertificateFinding[],
): void {
  const declaredMap = new Map(declared.map((edge) => [tupleKey(edge), edge]));
  for (const [key, edge] of derived) {
    if (!declaredMap.has(key)) {
      findings.push(
        finding(
          'coverage',
          'edge-missing',
          `${edge[0]} -> ${edge[1]} is absent from certificate edges`,
        ),
      );
    }
  }
  for (const [key, edge] of declaredMap) {
    if (!derived.has(key)) {
      findings.push(
        finding(
          'coverage',
          'edge-extra',
          `${edge[0]} -> ${edge[1]} is not present in artifact imports`,
        ),
      );
    }
  }
}

function compareOpaque(
  declared: readonly { module: string; reason: string }[],
  derived: ReadonlyMap<string, { module: string; reason: string }>,
  findings: KovoCertificateFinding[],
): void {
  const declaredMap = new Map(declared.map((entry) => [`${entry.module}\0${entry.reason}`, entry]));
  for (const [key, entry] of derived) {
    if (!declaredMap.has(key)) {
      findings.push(
        finding(
          'coverage',
          'opaque-missing',
          `${entry.module} is missing opaque reason ${entry.reason}`,
        ),
      );
    }
  }
  for (const [key, entry] of declaredMap) {
    if (!derived.has(key)) {
      findings.push(
        finding(
          'coverage',
          'opaque-extra',
          `${entry.module} declares absent opaque reason ${entry.reason}`,
        ),
      );
    }
  }
}

function checkStability(
  certificate: KovoCertificateV1,
  localCapabilities: ReadonlyMap<string, ReadonlySet<KovoCertificateCapabilityKind>>,
): KovoCertificateFinding[] {
  const findings: KovoCertificateFinding[] = [];
  for (const module of Object.keys(certificate.cap)) {
    const summary = new Set(certificate.cap[module]);
    for (const capability of localCapabilities.get(module) ?? []) {
      if (!summary.has(capability)) {
        findings.push(
          finding(
            'stability',
            'local-capability-missing',
            `${module} imports raw capability ${capability} absent from cap summary`,
          ),
        );
      }
    }
  }
  for (const [from, to] of certificate.edges) {
    const importer = new Set(certificate.cap[from]);
    for (const capability of certificate.cap[to] ?? []) {
      if (!importer.has(capability)) {
        findings.push(
          finding(
            'stability',
            'edge-capability-missing',
            `${from} omits ${capability} summarized by imported module ${to}`,
          ),
        );
      }
    }
  }
  return findings.sort(compareFindings);
}

function checkClosure(
  certificate: KovoCertificateV1,
  policy: KovoCertificatePolicyV1,
): KovoCertificateFinding[] {
  const doors = new Map<string, Set<KovoCertificateCapabilityKind>>();
  // Door admission is deliberately coarse at module + capability granularity. `site` remains an
  // exact reviewer label in the policy binding, but it is not a source-location proof.
  for (const door of policy.doors) {
    const capabilities = doors.get(door.module) ?? new Set<KovoCertificateCapabilityKind>();
    capabilities.add(door.escapeId);
    doors.set(door.module, capabilities);
  }
  const findings: KovoCertificateFinding[] = [];
  for (const root of policy.roots) {
    const admitted = doors.get(root.module) ?? new Set<KovoCertificateCapabilityKind>();
    for (const capability of certificate.cap[root.module] ?? []) {
      if (!admitted.has(capability)) {
        findings.push(
          finding(
            'closure',
            'root-capability-unclosed',
            `${root.rootKind} root ${root.module} reaches ${capability} without a same-module door`,
          ),
        );
      }
    }
  }
  return findings.sort(compareFindings);
}

function verificationResult(
  findings: readonly KovoCertificateFinding[],
  certificate?: KovoCertificateV1,
): KovoCertificateVerificationResult {
  const cap = certificate === undefined ? [] : Object.values(certificate.cap).flat();
  return {
    findings: [...findings].sort(compareFindings),
    ok: findings.length === 0,
    stats: {
      artifacts: certificate?.artifacts.length ?? 0,
      capabilities: cap.length,
      doors: certificate?.doors.length ?? 0,
      edges: certificate?.edges.length ?? 0,
      opaque: certificate?.opaque.length ?? 0,
      roots: certificate?.roots.length ?? 0,
    },
  };
}

function classifyRawCapabilityModuleSpecifier(
  specifier: string,
): KovoCertificateCapabilityKind | undefined {
  const withoutNode = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (withoutNode === 'crypto') return 'crypto-acquisition';
  const builtin = rawModuleCapabilities.get(withoutNode.split('/')[0]!);
  if (builtin !== undefined) return builtin;
  const packageName = packageNameForSpecifier(specifier);
  if (packageName === '@node-rs/argon2') return 'crypto-acquisition';
  if (rawDatabasePackages.has(packageName)) return 'database-driver';
  if (
    packageName === 'drizzle-orm' &&
    /\/(?:better-sqlite3|bun-sqlite|d1|durable-sqlite|expo-sqlite|libsql|mysql2|neon|node-postgres|op-sqlite|pglite|postgres-js|sql-js|sqlite-proxy|tidb-serverless|vercel-postgres)(?:\/|$)/u.test(
      specifier,
    )
  ) {
    return 'database-driver';
  }
  return undefined;
}

function classifyRawCapabilityImport(
  source: string,
  imported: { d: number; s: number; ss: number },
  specifier: string,
): KovoCertificateCapabilityKind | undefined {
  const withoutNode = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (withoutNode !== 'crypto') return classifyRawCapabilityModuleSpecifier(specifier);
  return imported.d === -1 && isExactDigestOnlyCryptoImport(source.slice(imported.ss, imported.s))
    ? 'digest'
    : 'crypto-acquisition';
}

function isExactDigestOnlyCryptoImport(prefix: string): boolean {
  const match = /^\s*(?:import|export)\s*\{([\s\S]*)\}\s*from\s*['"]$/u.exec(prefix);
  if (match === null) return false;
  const importedNames = match[1];
  if (importedNames === undefined) return false;
  const entries = importedNames.split(',');
  if (entries.at(-1)?.trim() === '') entries.pop();
  return (
    entries.length > 0 &&
    entries.every((entry) =>
      /^(?:createHash|hash)(?:\s+as\s+[$A-Z_a-z][$\w]*)?$/u.test(entry.trim()),
    )
  );
}

function packageNameForSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const parts = specifier.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

function isCanonicalArtifactPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return (
    parts.length >= 4 &&
    parts[0] === '@kovojs' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(parts[1] ?? '') &&
    parts[2] === 'dist' &&
    parts.slice(3).every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    parts.at(-1) !== '.mjs' &&
    value.endsWith('.mjs') &&
    !value.includes('\\') &&
    !value.includes('//') &&
    !value.includes('?') &&
    !value.includes('#') &&
    !value.includes('\0') &&
    path.posix.normalize(value) === value &&
    !value.split('/').includes('..')
  );
}

function packageNameFromArtifact(value: string): string {
  return value.split('/').slice(0, 2).join('/');
}

function isCanonicalPackageName(value: unknown): value is string {
  return typeof value === 'string' && /^@kovojs\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isCanonicalExportSubpath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '.') return true;
  return (
    value.startsWith('./') &&
    !value.includes('\\') &&
    !value.includes('*') &&
    !value.includes('?') &&
    !value.includes('#') &&
    path.posix.normalize(value.slice(2)) === value.slice(2) &&
    !value.split('/').includes('..')
  );
}

function isSha512(value: unknown): value is string {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(value)) return false;
  const encoded = value.slice('sha512-'.length);
  try {
    return Buffer.from(encoded, 'base64').toString('base64') === encoded;
  } catch {
    return false;
  }
}

function isCapability(value: unknown): value is KovoCertificateCapabilityKind {
  return typeof value === 'string' && capabilityIndex.has(value as KovoCertificateCapabilityKind);
}

function isNonemptyText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 4096
  );
}

function sha512(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function sortCapabilities(
  values: readonly KovoCertificateCapabilityKind[],
): KovoCertificateCapabilityKind[] {
  return [...values].sort(
    (left, right) => capabilityIndex.get(left)! - capabilityIndex.get(right)!,
  );
}

function finding(
  obligation: KovoCertificateFinding['obligation'],
  code: string,
  message: string,
): KovoCertificateFinding {
  return { code, message, obligation };
}

function tupleKey(value: readonly [string, string]): string {
  return `${value[0]}\0${value[1]}`;
}

function compareTuples(left: readonly [string, string], right: readonly [string, string]): number {
  return compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]);
}

function compareFindings(left: KovoCertificateFinding, right: KovoCertificateFinding): number {
  return (
    compareStrings(left.obligation, right.obligation) ||
    compareStrings(left.code, right.code) ||
    compareStrings(left.message, right.message)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
