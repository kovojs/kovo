#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

const SOURCE_FILES = [
  'packages/core/src/internal/security-operation-ir.ts',
  'packages/compiler/src/compile.ts',
  'packages/compiler/src/browser-posture-project.ts',
  'packages/server/src/internal/data-plane-static-analysis.ts',
  'packages/server/src/internal/runtime-registry-wire.ts',
  'packages/server/src/generated-browser-posture-registry.ts',
  'packages/server/src/browser-response-posture.ts',
  'packages/server/src/csp.ts',
  'packages/server/src/document-core.ts',
  'packages/server/src/hints.ts',
  'packages/server/src/response.ts',
  'packages/cli/src/commands/build-export.ts',
];

const REQUIRED_LINKS = [
  {
    file: 'packages/core/src/internal/security-operation-ir.ts',
    snippets: ['kovo-browser-posture/v1', 'interface BrowserPostureManifest'],
  },
  {
    file: 'packages/compiler/src/compile.ts',
    snippets: ['browserPostureManifest: compileBrowserPostureManifest', 'browser.framework.call'],
  },
  {
    file: 'packages/compiler/src/browser-posture-project.ts',
    snippets: ['deriveBrowserPostureManifestFromSourceFiles', 'mergeBrowserPostureManifests'],
  },
  {
    file: 'packages/server/src/internal/data-plane-static-analysis.ts',
    snippets: ['browserPosture: deriveBrowserPostureManifestFromSourceFiles(analysis.files)'],
  },
  {
    file: 'packages/server/src/internal/runtime-registry-wire.ts',
    snippets: ['registerGeneratedBrowserPostureManifest', 'registry.browserPosture'],
  },
  {
    file: 'packages/server/src/generated-browser-posture-registry.ts',
    snippets: ['snapshotBrowserPostureManifest', 'registeredGeneratedBrowserPostureManifest'],
  },
  {
    file: 'packages/server/src/csp.ts',
    snippets: ['browserPostureCspSources', 'assertDocumentCspConfigMatchesBrowserPosture'],
  },
  {
    file: 'packages/server/src/document-core.ts',
    snippets: [
      'assertPageHintsCrossOriginIsolationEligible',
      'browserResponsePostureHeaders',
      'crossOriginIsolation requires',
    ],
  },
  {
    file: 'packages/server/src/hints.ts',
    snippets: ['assertPageHintsCrossOriginIsolationEligible', 'external modulepreload page hint'],
  },
  {
    file: 'packages/cli/src/commands/build-export.ts',
    snippets: [
      'assertDocumentCspConfigMatchesBrowserPosture',
      'browserPosture: staticRuntimeRegistry.browserPosture',
    ],
  },
];

export function evaluateBrowserPostureDerivation(sources) {
  const findings = [];
  for (const requirement of REQUIRED_LINKS) {
    const source = sources[requirement.file];
    if (typeof source !== 'string') {
      findings.push(`${requirement.file}: source is missing`);
      continue;
    }
    for (const snippet of requirement.snippets) {
      if (!source.includes(snippet)) findings.push(`${requirement.file}: missing ${snippet}`);
    }
  }

  const core = sources['packages/core/src/internal/security-operation-ir.ts'] ?? '';
  const posture = sources['packages/server/src/browser-response-posture.ts'] ?? '';
  const operationKinds = sourceStringLiterals(
    sourceBetween(core, 'export const browserSecurityOperationKinds', '] as const'),
    /^browser\./u,
  );
  const policyCases = sourceStringLiterals(
    sourceBetween(
      posture,
      'function permissionsRequiredByOperation',
      '/** Render the one Permissions-Policy',
    ),
    /^browser\./u,
  );
  for (const kind of operationKinds) {
    if (!policyCases.includes(kind)) findings.push(`Permissions-Policy switch is missing ${kind}`);
  }
  for (const kind of policyCases) {
    if (!operationKinds.includes(kind))
      findings.push(`Permissions-Policy switch has unknown ${kind}`);
  }
  if (!posture.includes('const unsupported: never = kind')) {
    findings.push('Permissions-Policy switch has no never exhaustiveness verdict');
  }

  const response = sources['packages/server/src/response.ts'] ?? '';
  const document = sources['packages/server/src/document-core.ts'] ?? '';
  if (!response.includes("'Permissions-Policy': DEFAULT_BROWSER_PERMISSIONS_POLICY")) {
    findings.push('response baseline does not consume the sole derived Permissions-Policy owner');
  }
  if (response.includes('camera=()') || document.includes('camera=()')) {
    findings.push('a document response site duplicates the Permissions-Policy feature list');
  }
  if (document.includes('permissionsPolicyWithReporting')) {
    findings.push('document reporting still owns an independent Permissions-Policy renderer');
  }

  return gateResult(findings);
}

export function checkBrowserPostureDerivation({ rootDir = repoRoot } = {}) {
  const sources = Object.create(null);
  for (const file of SOURCE_FILES) sources[file] = readFileSync(path.join(rootDir, file), 'utf8');
  return evaluateBrowserPostureDerivation(sources);
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function sourceStringLiterals(source, pattern) {
  const values = [];
  for (const match of source.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/gu)) {
    const value = match[1];
    if (value !== undefined && pattern.test(value)) values.push(value);
  }
  return [...new Set(values)].sort();
}

function gateResult(findings) {
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK compiler census, generated registry, CSP, isolation, and Permissions-Policy are structurally bound'
        : `${findings.length} browser-posture derivation violation(s)`,
  };
}

export function main() {
  const checked = checkBrowserPostureDerivation();
  process.stdout.write(`browser-posture-derivation/v1 ${checked.summary}\n`);
  for (const finding of checked.findings) process.stderr.write(`${finding}\n`);
  return checked.ok;
}

if (isMainEntry(import.meta.url)) runGate(main);
