#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const csrfMintDeliverySchema = 'kovo.csrf-mint-delivery/v1';
export const defaultCsrfMintDeliveryPath = 'security/csrf-mint-delivery.json';

const expectedLifecycle = Object.freeze({
  'anonymous-document-bootstrap': [
    'framework-bundle',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'idem-deduplicated',
  ],
  'cache-posture': [
    'reuse-binding',
    'private-no-store-cookie-vary',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'not-replayable',
  ],
  'cloned-request': [
    'reuse-binding',
    'response-lifecycle',
    'canonical-ingress',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'error-and-not-found': [
    'reuse-binding',
    'seal-before-replacement',
    'not-applicable',
    'not-applicable',
    'not-replayable',
  ],
  'exact-ingress-validation': [
    'forbidden',
    'existing-binding',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'not-replayable',
  ],
  'immediate-stream': [
    'raw-endpoint-audience',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'late-stream': [
    'forbidden-after-seal',
    'forbidden-after-seal',
    'not-applicable',
    'not-applicable',
    'not-replayable',
  ],
  'live-target-binding': [
    'reuse-binding',
    'same-response',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'idem-deduplicated',
  ],
  'mutation-replay': [
    'reuse-binding',
    'existing-binding',
    'before-replay',
    'principal-isolated',
    'idem-deduplicated',
  ],
  'nested-handler': [
    'independent-lifecycle',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'no-js-redirect': [
    'reuse-binding',
    'existing-binding',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'idem-deduplicated',
  ],
  'packed-node-vercel': [
    'framework-and-raw',
    'response-lifecycle',
    'generated-parity',
    'generated-parity',
    'generated-parity',
  ],
  'query-channel': [
    'forbidden',
    'no-browser-authority',
    'read-only',
    'not-applicable',
    'read-only',
  ],
  'raw-endpoint-form-bootstrap': [
    'raw-endpoint-audience',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'raw-endpoint-json-bootstrap': [
    'raw-endpoint-audience',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'reused-exact-request': [
    'independent-lifecycle',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'protocol-owned',
  ],
  'session-rotation': [
    'reuse-binding',
    'existing-binding',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'principal-isolated',
  ],
  'typed-mutation-form': [
    'framework-bundle',
    'response-lifecycle',
    'exact-ingress-audience',
    'old-rejected-new-required',
    'idem-deduplicated',
  ],
});

const lifecycleFields = Object.freeze(['mint', 'deliver', 'validate', 'rotate', 'replay']);

const expectedCanaries = Object.freeze({
  'accept-pre-rotation-token': 'session-rotation',
  'allow-partial-public-mutation-helper': 'typed-mutation-form',
  'drop-header-seal': 'late-stream',
  'drop-lifecycle-receipt': 'anonymous-document-bootstrap',
  'make-csrf-response-cacheable': 'cache-posture',
  'replay-before-csrf': 'mutation-replay',
});

export function validateCsrfMintDelivery({
  matrixPath = defaultCsrfMintDeliveryPath,
  rootDir = repoRoot(),
} = {}) {
  let document;
  try {
    document = JSON.parse(readFileSync(path.join(rootDir, matrixPath), 'utf8'));
  } catch (error) {
    return result([`${matrixPath}: cannot read valid JSON: ${error.message}`]);
  }
  const check = validateCsrfMintDeliveryDocument(document, {
    checkProofs: true,
    label: matrixPath,
    rootDir,
  });
  validateRepositoryContract(rootDir, check.findings);
  return result(check.findings, check.summary);
}

export function validateCsrfMintDeliveryDocument(
  document,
  { checkProofs = false, label = defaultCsrfMintDeliveryPath, rootDir = repoRoot() } = {},
) {
  const findings = [];
  if (!plainObject(document)) return result([`${label}: root must be an object`]);
  if (document.schema !== csrfMintDeliverySchema) {
    findings.push(`${label}: schema must be ${csrfMintDeliverySchema}`);
  }

  const surfaces = Array.isArray(document.surfaces) ? document.surfaces : [];
  if (!Array.isArray(document.surfaces)) findings.push(`${label}: surfaces must be an array`);
  const byId = new Map();
  for (const [index, surface] of surfaces.entries()) {
    const surfaceLabel = `${label}: surfaces[${index}]`;
    if (!plainObject(surface)) {
      findings.push(`${surfaceLabel} must be an object`);
      continue;
    }
    if (typeof surface.id !== 'string' || surface.id === '') {
      findings.push(`${surfaceLabel}.id must be non-empty`);
      continue;
    }
    if (byId.has(surface.id)) findings.push(`${surfaceLabel}.id duplicates ${surface.id}`);
    byId.set(surface.id, surface);
  }

  compareExactSet(
    [...byId.keys()],
    Object.keys(expectedLifecycle),
    `${label}: surface ids`,
    findings,
  );
  for (const [id, expected] of Object.entries(expectedLifecycle)) {
    const surface = byId.get(id);
    if (!surface) continue;
    for (const [fieldIndex, field] of lifecycleFields.entries()) {
      if (surface[field] !== expected[fieldIndex]) {
        findings.push(`${label}: ${id}.${field} must be ${expected[fieldIndex]}`);
      }
    }
    validateProof(surface.proof, `${label}: ${id}.proof`, rootDir, checkProofs, findings);
  }

  const canaries = Array.isArray(document.canaries) ? document.canaries : [];
  if (!Array.isArray(document.canaries)) findings.push(`${label}: canaries must be an array`);
  const canariesById = new Map();
  for (const [index, canary] of canaries.entries()) {
    const canaryLabel = `${label}: canaries[${index}]`;
    if (!plainObject(canary) || typeof canary.id !== 'string') {
      findings.push(`${canaryLabel} must name an id`);
      continue;
    }
    if (canariesById.has(canary.id)) findings.push(`${canaryLabel}.id duplicates ${canary.id}`);
    canariesById.set(canary.id, canary);
  }
  compareExactSet(
    [...canariesById.keys()],
    Object.keys(expectedCanaries),
    `${label}: canary ids`,
    findings,
  );
  for (const [id, killedBy] of Object.entries(expectedCanaries)) {
    if (canariesById.get(id)?.killedBy !== killedBy) {
      findings.push(`${label}: canary ${id} must be killed by ${killedBy}`);
    }
  }

  return result(findings, { canaryCount: canaries.length, surfaceCount: surfaces.length });
}

function validateProof(proof, label, rootDir, checkProofs, findings) {
  if (!plainObject(proof) || typeof proof.file !== 'string' || typeof proof.anchor !== 'string') {
    findings.push(`${label} must name a file and anchor`);
    return;
  }
  if (!checkProofs) return;
  let source;
  try {
    source = readFileSync(path.join(rootDir, proof.file), 'utf8');
  } catch {
    findings.push(`${label} file does not exist: ${proof.file}`);
    return;
  }
  if (!source.includes(proof.anchor)) {
    findings.push(`${label} anchor is stale in ${proof.file}: ${proof.anchor}`);
  }
}

function validateRepositoryContract(rootDir, findings) {
  requireSource(
    rootDir,
    'packages/server/src/api/data.ts',
    ['mutation?: never', "if ('mutation' in context)", 'Kovo emits CSRF and Kovo-Idem together'],
    findings,
  );
  const rootApi = source(rootDir, 'packages/server/src/index.ts', findings);
  if (/\bcsrf(?:Field|Token),/u.test(rootApi)) {
    findings.push(
      'packages/server/src/index.ts: partial csrfField/csrfToken helpers must stay off root',
    );
  }
  requireSource(
    rootDir,
    'packages/server/src/response-lifecycle-context.ts',
    [
      'hasResponseLifecycleReceipt',
      'recordResponseLifecycleSetCookie',
      'sealResponseLifecycleRequestAndSnapshotSetCookies',
      'after response headers were committed',
    ],
    findings,
  );
  requireSource(
    rootDir,
    'packages/core/src/internal/source-sink-registry.ts',
    ['security/csrf-mint-delivery.json', 'response-lifecycle receipt'],
    findings,
  );
  requireSource(
    rootDir,
    'scripts/check-security-classifier-corpus.mjs',
    ['csrf-mint-delivery-matrix', 'shares one packed anonymous-CSRF witness'],
    findings,
  );
  requireSource(
    rootDir,
    'spec/06-type-system.md',
    ['sole complete public mutation-form bundle', 'raw endpoint protocol'],
    findings,
  );
  requireSource(
    rootDir,
    'package.json',
    ['check:csrf-mint-delivery', 'node scripts/check-csrf-mint-delivery.mjs'],
    findings,
  );
}

function requireSource(rootDir, file, needles, findings) {
  const text = source(rootDir, file, findings);
  for (const needle of needles) {
    if (!text.includes(needle)) findings.push(`${file}: missing CSRF delivery contract ${needle}`);
  }
}

function source(rootDir, file, findings) {
  try {
    return readFileSync(path.join(rootDir, file), 'utf8');
  } catch {
    findings.push(`${file}: cannot read source`);
    return '';
  }
}

function compareExactSet(actual, expected, label, findings) {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    findings.push(`${label} must equal ${expectedSorted.join(', ')}`);
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

export function runCsrfMintDeliveryCheck(options = {}) {
  const check = validateCsrfMintDelivery(options);
  if (check.ok) {
    process.stdout.write(
      `check-csrf-mint-delivery/v1\nOK surfaces=${check.summary.surfaceCount} canaries=${check.summary.canaryCount}\n`,
    );
    return 0;
  }
  process.stderr.write(
    `check-csrf-mint-delivery/v1\nFAIL findings=${check.findings.length}:\n${check.findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  return 1;
}

async function main() {
  process.exitCode = runCsrfMintDeliveryCheck();
}

if (isMainEntry(import.meta.url)) await runGate(main);
