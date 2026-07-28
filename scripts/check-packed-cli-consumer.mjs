#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  packageSubjectFromSnapshotKey,
  parsePnpmSnapshotDependencies,
} from './lib/pnpm-lock-packages.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';
import { parsePnpmAuditResult } from './supply-chain-gates.mjs';

export const forbiddenPackedCliDependencies = Object.freeze([
  '@hono/node-server',
  '@modelcontextprotocol/sdk',
  'ajv',
  'body-parser',
  'express',
  'fast-uri',
  'hono',
]);

const expectedMcpTools = Object.freeze([
  'compile_component',
  'kovo_check',
  'kovo_docs',
  'kovo_explain',
  'list_diagnostics',
]);

export function productionDependencyNamesFromLockfile(lockfileText) {
  const { findings, snapshots } = parsePnpmSnapshotDependencies(lockfileText, {
    lockfilePath: 'packed-consumer/pnpm-lock.yaml',
  });
  if (findings.length > 0) {
    throw new Error(`Packed CLI consumer lockfile is invalid:\n  ${findings.join('\n  ')}`);
  }
  return [
    ...new Set(
      [...snapshots.keys()]
        .map((key) => packageSubjectFromSnapshotKey(key)?.dependency)
        .filter((name) => name !== undefined),
    ),
  ].sort(compareStrings);
}

export function assertPackedCliDependencyClosure(lockfileText) {
  const names = new Set(productionDependencyNamesFromLockfile(lockfileText));
  const present = forbiddenPackedCliDependencies.filter((name) => names.has(name));
  if (present.length > 0) {
    throw new Error(
      `Packed CLI production graph contains the removed MCP SDK subtree: ${present.join(', ')}`,
    );
  }
}

export function assertPackedMcpLifecycle(stdout) {
  let responses;
  try {
    responses = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error('Packed kovo mcp emitted non-NDJSON stdout');
  }
  if (
    responses.length !== 2 ||
    responses[0]?.id !== 1 ||
    responses[0]?.result?.protocolVersion !== '2025-11-25' ||
    responses[1]?.id !== 2 ||
    !Array.isArray(responses[1]?.result?.tools)
  ) {
    throw new Error('Packed kovo mcp did not complete the finite lifecycle');
  }
  const toolNames = responses[1].result.tools
    .map((tool) => tool?.name)
    .filter((name) => typeof name === 'string')
    .sort(compareStrings);
  if (JSON.stringify(toolNames) !== JSON.stringify(expectedMcpTools)) {
    throw new Error(`Packed kovo mcp tool vocabulary drifted: ${JSON.stringify(toolNames)}`);
  }
}

export function assertPackedDocsJourney(updateStdout, docsStdout, consumerRoot) {
  if (
    !/^kovo-update-docs\/v1\nOK source=installed-package version=[^\s]+ files=\d+\nOK snapshot=sha256:[a-f0-9]{64} current=\.kovo\/docs\/current\.json\n$/u.test(
      updateStdout,
    )
  ) {
    throw new Error('Packed kovo update-docs did not authenticate and select its bundled snapshot');
  }

  let payload;
  try {
    payload = JSON.parse(docsStdout);
  } catch {
    throw new Error('Packed kovo docs emitted non-JSON output for --format json');
  }
  if (
    payload?.version !== 'kovo-docs/v1' ||
    !Array.isArray(payload.results) ||
    payload.results.length === 0 ||
    payload.results.length > 5
  ) {
    throw new Error('Packed kovo docs did not return a bounded kovo-docs/v1 result');
  }

  const snapshotDigests = new Set();
  for (const result of payload.results) {
    if (
      typeof result?.path !== 'string' ||
      result.path.startsWith('/') ||
      result.path.split('/').includes('..') ||
      typeof result.excerpt !== 'string' ||
      result.excerpt.length === 0 ||
      result.excerpt.includes('Bundled starter placeholder') ||
      !/^sha256:[a-f0-9]{64}$/u.test(result.sha256) ||
      !/^sha256:[a-f0-9]{64}$/u.test(result.snapshotDigest) ||
      typeof result.version !== 'string' ||
      result.version.length === 0
    ) {
      throw new Error('Packed kovo docs returned malformed, unsafe, or placeholder content');
    }
    snapshotDigests.add(result.snapshotDigest);
  }
  if (snapshotDigests.size !== 1) {
    throw new Error('Packed kovo docs mixed results from more than one authenticated snapshot');
  }

  const pointer = JSON.parse(
    readFileSync(path.join(consumerRoot, '.kovo', 'docs', 'current.json'), 'utf8'),
  );
  const [snapshotDigest] = snapshotDigests;
  if (pointer?.snapshotDigest !== snapshotDigest) {
    throw new Error('Packed kovo docs result does not match the selected snapshot pointer');
  }
  const agents = readFileSync(path.join(consumerRoot, 'AGENTS.md'), 'utf8');
  const digestDirectory = snapshotDigest.slice('sha256:'.length);
  if (
    !agents.includes(`./.kovo/docs/snapshots/${digestDirectory}/kovo-rules.md`) ||
    agents.includes('Bundled starter placeholder')
  ) {
    throw new Error('Packed kovo update-docs did not install authenticated agent instructions');
  }
}

export function checkPackedCliConsumer() {
  const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  for (const pkg of packedPackages) {
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  }

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-cli-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        packedCliConsumerManifest(packedPackages, rootManifest.packageManager),
        null,
        2,
      )}\n`,
      'utf8',
    );
    runCommand(
      'pnpm',
      ['install', '--prod', '--ignore-scripts', '--no-frozen-lockfile'],
      consumerRoot,
      'install',
    );

    const lockfileText = readFileSync(path.join(consumerRoot, 'pnpm-lock.yaml'), 'utf8');
    assertPackedCliDependencyClosure(lockfileText);

    const updateDocs = runCommand(
      'pnpm',
      ['exec', 'kovo', 'update-docs'],
      consumerRoot,
      'authenticated docs install',
    );
    const docs = runCommand(
      'pnpm',
      ['exec', 'kovo', 'docs', 'quickstart', '--format', 'json'],
      consumerRoot,
      'bounded local docs retrieval',
    );
    assertPackedDocsJourney(updateDocs.stdout, docs.stdout, consumerRoot);

    const lifecycle = runCommand(
      'pnpm',
      ['exec', 'kovo', 'mcp'],
      consumerRoot,
      'finite MCP lifecycle',
      finiteMcpLifecycleInput(),
    );
    assertPackedMcpLifecycle(lifecycle.stdout);

    const auditResult = spawnSync('pnpm', ['audit', '--prod', '--json'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const audit = parsePnpmAuditResult(auditResult);
    const advisories = Object.values(audit.advisories);
    if (advisories.length > 0) {
      throw new Error(
        `Packed CLI consumer audit reported ${advisories
          .map((advisory) => `${advisory.severity} ${advisory.module_name}`)
          .join(', ')}`,
      );
    }

    process.stdout.write(
      `Packed CLI consumer passed (${audit.metadata.dependencies} production dependencies, zero advisories).\n`,
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function packedCliConsumerManifest(packedPackages, packageManager) {
  const tarballs = Object.fromEntries(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const cliTarball = tarballs['@kovojs/cli'];
  if (cliTarball === undefined) throw new Error('Packed release manifest is missing @kovojs/cli');
  return {
    dependencies: { '@kovojs/cli': cliTarball },
    name: 'kovo-packed-cli-consumer',
    packageManager,
    pnpm: { overrides: tarballs },
    private: true,
    version: '0.0.0',
  };
}

function finiteMcpLifecycleInput() {
  return `${[
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'packed-consumer', version: '1.0.0' },
        protocolVersion: '2025-11-25',
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { id: 2, jsonrpc: '2.0', method: 'tools/list' },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n')}\n`;
}

function runCommand(command, args, cwd, label, input) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.signal || result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(
      `Packed CLI consumer ${label} failed${result.status === null ? '' : ` with status ${result.status}`}: ${detail || result.error?.message || '<no output>'}`,
    );
  }
  return result;
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedCliConsumer);
