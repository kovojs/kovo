#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const cacheInfluenceManifestSchema = 'kovo-cache-influence/v1';
export const repoRoot = findRepoRoot();

const productionRequirements = [
  {
    file: 'packages/core/src/internal/cache-influence.ts',
    snippets: [
      "'kovo-cache-influence/v1'",
      "kind: 'url-path'",
      "kind: 'url-search'",
      "kind: 'request-header'",
      "| 'authorization'",
      "| 'cookie'",
      "| 'principal'",
      "| 'secret'",
      "| 'session'",
      "| 'unclassified'",
      "role: 'external-version-key' | 'shared-cache-closed'",
    ],
  },
  {
    file: 'packages/compiler/src/cache-influence-facts.ts',
    snippets: [
      'componentCacheInfluenceFacts',
      'inputWithSemanticInfluences',
      "trace.verdict === 'closed'",
      'deriveCacheInfluenceManifestEntry(input)',
    ],
  },
  {
    file: 'packages/server/src/query.ts',
    snippets: [
      'registeredCacheInfluenceForRoot(`query:${definition.key}`)',
      'manifest.verdict === \'shared-cache-closed\'',
      'runtimeCacheInfluenceClosesPublic(rawRequest, lifecycleRequest)',
      "queryRequestHeader(rawRequest, 'cookie')",
      "queryRequestHeader(rawRequest, 'authorization')",
    ],
  },
  {
    file: 'packages/server/src/app-document.ts',
    snippets: [
      "requestHeader(request, 'cookie')",
      "requestHeader(request, 'authorization')",
      'registeredCacheInfluenceForRoot(`document:${route.path}`)',
      "manifest.verdict !== 'shared-cache-closed'",
    ],
  },
  {
    file: 'packages/server/src/internal/runtime-registry-wire.ts',
    snippets: [
      'snapshotCacheInfluenceManifest',
      'registerGeneratedCacheInfluenceManifest',
    ],
  },
  {
    file: 'packages/cli/src/commands/build-export.ts',
    snippets: [
      'assertBuildCacheGenerality(app, result.graph)',
      'public intent has no compiler manifest entry',
      'authored intent differs from the compiler manifest',
    ],
  },
  {
    file: 'packages/server/src/cache-generality-intermediary.security.test.ts',
    snippets: [
      'cache generality through a real intermediary',
      'x-intermediary-cache',
      'query variants, header variants, and branch changes',
    ],
  },
];

/** Diff runtime/authored cache declarations against the exact compiler manifest. */
export function validateCacheGenerality({ authoredIntents, manifest }) {
  const findings = [];
  if (manifest?.schema !== cacheInfluenceManifestSchema || !Array.isArray(manifest?.entries)) {
    findings.push(`cache manifest schema must be ${cacheInfluenceManifestSchema}`);
    return result(findings);
  }
  const byRoot = new Map();
  for (const entry of manifest.entries) {
    if (typeof entry?.root !== 'string' || entry.root.length === 0) {
      findings.push('cache manifest entry has no root');
      continue;
    }
    if (byRoot.has(entry.root)) findings.push(`${entry.root}: duplicate cache manifest entry`);
    byRoot.set(entry.root, entry);
    validateEntry(entry, findings);
  }
  if (!Array.isArray(authoredIntents)) {
    findings.push('authored cache intents must be an array');
    return result(findings);
  }
  for (const intent of authoredIntents) {
    if (typeof intent?.root !== 'string') {
      findings.push('authored cache intent has no root');
      continue;
    }
    const entry = byRoot.get(intent.root);
    if (entry === undefined) {
      if (intent.posture === 'public') {
        findings.push(`${intent.root}: public cache intent has no compiler-derived manifest entry`);
      }
      continue;
    }
    if (
      entry.surface !== intent.surface ||
      entry.authored?.posture !== intent.posture ||
      (entry.authored?.cacheControl ?? undefined) !== (intent.cacheControl ?? undefined)
    ) {
      findings.push(`${intent.root}: authored cache intent differs from compiler manifest`);
    }
    if (intent.posture === 'public' && entry.verdict === 'shared-cache-closed') {
      findings.push(`${intent.root}: public cache intent is closed without a named audited escape`);
    }
  }
  return result(findings);
}

function validateEntry(entry, findings) {
  if (!Array.isArray(entry.axes) || !Array.isArray(entry.vary)) {
    findings.push(`${entry.root}: axes and Vary must be arrays`);
    return;
  }
  const headerAxes = new Set();
  let closes = false;
  for (const axis of entry.axes) {
    if (axis?.kind === 'request-header' && axis.role === 'vary' && typeof axis.name === 'string') {
      headerAxes.add(axis.name.toLowerCase());
    } else if (axis?.role === 'shared-cache-closed') {
      closes = true;
    }
  }
  for (const token of entry.vary) {
    const normalized = typeof token === 'string' ? token.toLowerCase() : '';
    if (!headerAxes.has(normalized)) {
      findings.push(
        `${entry.root}: Vary token ${String(token)} is not a compiler-derived request-header axis`,
      );
    }
  }
  for (const header of headerAxes) {
    if (!entry.vary.some((token) => token.toLowerCase() === header)) {
      findings.push(`${entry.root}: request-header axis ${header} is missing from Vary`);
    }
  }
  if (closes && entry.verdict === 'public-proved') {
    findings.push(`${entry.root}: shared-cache-closing axis cannot have a public-proved verdict`);
  }
  if (entry.verdict === 'audited-escape') {
    if (
      typeof entry.auditedEscape?.name !== 'string' ||
      typeof entry.auditedEscape?.retainedObligation !== 'string'
    ) {
      findings.push(`${entry.root}: audited escape lacks a name or retained obligation`);
    }
  }
}

export function checkCacheGenerality({ rootDir = repoRoot } = {}) {
  const findings = [];
  for (const requirement of productionRequirements) {
    const source = readFileSync(path.join(rootDir, requirement.file), 'utf8');
    for (const snippet of requirement.snippets) {
      if (!source.includes(snippet)) findings.push(`${requirement.file}: missing ${snippet}`);
    }
  }
  return result(findings);
}

function result(findings) {
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK compiler cache manifest and runtime narrowing are structurally enrolled'
        : `${findings.length} cache-generality violation(s)`,
  };
}

export function main() {
  const checked = checkCacheGenerality();
  process.stdout.write(`check-cache-generality/v1 ${checked.summary}\n`);
  for (const finding of checked.findings) process.stderr.write(`${finding}\n`);
  return checked.ok;
}

if (isMainEntry(import.meta.url)) runGate(main);
