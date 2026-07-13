#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

export const REQUIRED_CLASSIFIER_CORPORA = [
  {
    id: 'redos',
    marker: '@kovo-security-classifier-corpus redos',
    testFiles: ['packages/server/src/redos.test.ts', 'packages/compiler/src/redos-pattern.test.ts'],
    verdictAnchors: [
      {
        id: 'nested-quantifier-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['([\\w)]+)+', 'toThrow(RedosPatternError)'],
      },
      {
        id: 'overlapping-alternatives-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['^(a|aa)+$', 'overlapping alternatives'],
      },
      {
        id: 'nested-overlapping-alternatives-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['((a|a))+', 'nested group interiors contain overlapping alternatives'],
      },
      {
        id: 'followup-17-b1-dollar-line-terminator-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['B1 trailing line terminator', "compileLinearPattern('a$')", "'a\\n'"],
      },
      {
        id: 'followup-17-b3-in-class-legacy-numeric-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: [
          'B3 in-class legacy numeric escape',
          "compileLinearPattern('^[^\\\\1-\\\\37]+$')",
        ],
      },
      {
        id: 'followup-17-p2-case-gap-range-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['P2 i-flag case-gap range', "'[A-_]'", "'[Z-a]'"],
      },
      {
        id: 'compiler-overlapping-alternatives-regression',
        file: 'packages/compiler/src/redos-pattern.test.ts',
        snippets: ['^(a|a)*$', "toContain('KV434')"],
      },
      {
        id: 'compiler-nested-overlapping-alternatives-regression',
        file: 'packages/compiler/src/redos-pattern.test.ts',
        snippets: ['((a|a))+', "toContain('KV434')"],
      },
    ],
  },
  {
    id: 'egress-ip',
    marker: '@kovo-security-classifier-corpus egress-ip',
    testFiles: ['packages/server/src/egress.test.ts'],
    verdictAnchors: [
      {
        id: 'octal-ip-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: ["normalizeIpLiteral('0177.0.0.1')", "'127.0.0.1'"],
      },
      {
        id: 'metadata-bypass-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: ["classifyIp('0xA9FEA9FE')", "'metadata'"],
      },
      {
        id: 'azure-identity-endpoint-provider-separation',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'Azure IDENTITY_ENDPOINT corpus',
          "identityEndpoint: 'http://127.1:40342/msi/token?api-version=2019-08-01'",
          "runWithMetadataAccess('azure'",
          "runWithMetadataAccess('aws'",
          "runWithMetadataAccess('gcp'",
          'reserves a hostname-configured identity port before its first DNS resolution',
          "identityEndpoint: 'http://identity.internal:40344/msi/token'",
        ],
      },
    ],
  },
  {
    id: 'better-auth-credentials',
    marker: '@kovo-security-classifier-corpus better-auth-credentials',
    testFiles: [
      'packages/better-auth/src/index.schema-bridge.test.ts',
      'packages/better-auth/src/index.schema-materialize.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'apikey-secret-classification',
        file: 'packages/better-auth/src/index.schema-bridge.test.ts',
        snippets: ["apiKey: { domain: 'auth', key: 'userId', secret: ['key'] }"],
      },
      {
        id: 'schema-intrinsic-poisoning-regression',
        file: 'packages/better-auth/src/index.schema-materialize.test.ts',
        snippets: [
          'keeps credential-table annotations after late schema-control poisoning',
          "kovo({ domain: 'auth', key: 'userId', secret: ['token'] })",
          'Object.keys = (() => [])',
          'RegExp.prototype.exec = (() => null)',
        ],
      },
    ],
  },
  {
    id: 'sink-registry',
    marker: '@kovo-security-classifier-corpus sink-registry',
    testFiles: ['packages/core/src/internal/source-sink-registry.test.ts'],
    verdictAnchors: [
      {
        id: 'redirect-url-mechanism',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: ["['redirect URL', 'reconstruct']"],
      },
      {
        id: 'outbound-egress-mechanism',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: ["['outbound egress request', 'own']"],
      },
    ],
  },
  {
    id: 'postgres-identity-posture',
    marker: '@kovo-security-classifier-corpus postgres-identity-posture',
    testFiles: ['packages/server/src/postgres-grant-shape-fuzzer.test.ts'],
    verdictAnchors: [
      {
        id: 'grant-shape-closure-fuzzer',
        file: 'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
        snippets: [
          'matches audit refusal to engine-reachable leak shapes across grants and object classes',
        ],
      },
      {
        id: 'identity-attribute-axis',
        file: 'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
        snippets: [
          'matches the identity-attribute axis against runtime-login and assumable-role posture',
        ],
      },
    ],
  },
  {
    id: 'kv418-request-authority',
    marker: '@kovo-security-classifier-corpus kv418-request-authority',
    testFiles: ['packages/compiler/src/scan/parse.test.ts'],
    verdictAnchors: [
      {
        id: 'direct-alias-dynamic-enumeration',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          "request.headers.get('COOKIE')",
          'const req = request',
          'input.headerName',
          'Object.fromEntries(headers)',
        ],
      },
      {
        id: 'wrapped-rest-arguments-and-mutable-names',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          "handler: ((_input, request) => request.headers.get('cookie'))",
          "let name = 'x-signature'",
          'arguments[1].headers',
          'handler: (...args)',
          "const name = 'cookie'",
        ],
      },
      {
        id: 'uninspectable-handlers-and-unresolved-keys',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          'handler: referencedHandler',
          '{ ...sharedOptions }',
          "const runtimeKey = 'machine/runtime'",
          'unresolvedName: true',
        ],
      },
    ],
  },
];

export function evaluateSecurityClassifierCorpus(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const corpora = options.corpora ?? REQUIRED_CLASSIFIER_CORPORA;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const run = options.run ?? ((testFiles) => runVitest(testFiles, root));
  const findings = [];
  const testFiles = [];
  const fileText = new Map();

  for (const corpus of corpora) {
    const markerFiles = [];
    for (const testFile of corpus.testFiles) {
      let text = '';
      try {
        text = readText(testFile);
      } catch {
        findings.push(`${corpus.id}: missing required corpus test file ${testFile}`);
        continue;
      }
      fileText.set(testFile, text);
      testFiles.push(testFile);
      if (text.includes(corpus.marker)) markerFiles.push(testFile);
    }
    if (markerFiles.length === 0) {
      findings.push(`${corpus.id}: no test file contains marker ${JSON.stringify(corpus.marker)}`);
    }
    for (const anchor of corpus.verdictAnchors ?? []) {
      const text = fileText.get(anchor.file);
      if (typeof text !== 'string') continue;
      const missing = anchor.snippets.filter((snippet) => !text.includes(snippet));
      if (missing.length > 0) {
        findings.push(
          `${corpus.id}: missing verdict anchor ${JSON.stringify(anchor.id)} in ${anchor.file}`,
        );
      }
    }
  }

  if (findings.length === 0) {
    const result = run([...new Set(testFiles)]);
    if (!result.ok) findings.push(result.output || 'security classifier corpus vitest failed');
  }

  return {
    corpora: corpora.length,
    findings,
    ok: findings.length === 0,
    testFiles: [...new Set(testFiles)],
  };
}

export function main(options = {}) {
  const result = evaluateSecurityClassifierCorpus(options);
  process.stdout.write(
    `check-security-classifier-corpus/v1 ${result.ok ? 'OK' : 'FAIL'} corpora=${result.corpora}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function runVitest(testFiles, root) {
  const result = spawnSync('pnpm', ['exec', 'vitest', '--run', ...testFiles], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
