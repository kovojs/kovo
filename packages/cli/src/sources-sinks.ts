import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import {
  dangerousSinkTokens as registryDangerousSinkTokens,
  frameworkSourceSinkInventory as registryFrameworkSourceSinkInventory,
  sourceSinkRedCorpus as registrySourceSinkRedCorpus,
  type DangerousSinkToken,
  type SourceSinkCorpusEntry,
  type SourceSinkInventoryEntry,
} from '@kovojs/core/internal/source-sink-registry';

import { type KovoCheckResult } from './shared.js';

export const sourcesSinksArtifactVersion = 'kovo-sources-sinks/v1';
export const sourcesSinksArtifactPath = join('.kovo', 'sources-sinks.json');

export type { DangerousSinkToken, SourceSinkInventoryEntry };
export type { SourceSinkCorpusEntry };

export interface SourceSinkInventoryArtifact {
  dangerousSinkTokens: readonly DangerousSinkToken[];
  driftScan?: SourceSinkDriftScanSummary;
  entries: readonly SourceSinkInventoryEntry[];
  generatedBy: 'kovo sources-sinks inventory';
  redCorpus: readonly SourceSinkCorpusEntry[];
  version: typeof sourcesSinksArtifactVersion;
}

export interface SourceSinkDriftFinding {
  count: number;
  file: string;
  owner: string;
  token: string;
}

export interface SourceSinkDriftScanSummary {
  findings: readonly SourceSinkDriftFinding[];
  roots: readonly string[];
  status: 'accounted';
  totalFiles: number;
  totalHits: number;
  unregistered: 0;
}

export interface SourcesSinksArtifactOptions {
  driftScan?: SourceSinkDriftScanSummary;
}

export interface SourcesSinksCheckOptions {
  driftScan?: SourceSinkDriftScanSummary;
}

/**
 * SPEC.md §4.8, §9.1, and §11.4 make these framework-owned source/sink facts
 * auditable. The shared registry lives in core-internal code so compiler,
 * server, browser, and CLI checks can consume the same facts.
 */
export function frameworkSourceSinkInventory(): readonly SourceSinkInventoryEntry[] {
  return registryFrameworkSourceSinkInventory();
}

export function dangerousSinkTokens(): readonly DangerousSinkToken[] {
  return registryDangerousSinkTokens();
}

export function sourceSinkRedCorpus(): readonly SourceSinkCorpusEntry[] {
  return registrySourceSinkRedCorpus();
}

export function sourcesSinksArtifact(
  options: SourcesSinksArtifactOptions = {},
): SourceSinkInventoryArtifact {
  const artifact: SourceSinkInventoryArtifact = {
    dangerousSinkTokens: dangerousSinkTokens(),
    entries: frameworkSourceSinkInventory(),
    generatedBy: 'kovo sources-sinks inventory',
    redCorpus: sourceSinkRedCorpus(),
    version: sourcesSinksArtifactVersion,
  };
  if (options.driftScan) artifact.driftScan = options.driftScan;
  return artifact;
}

export function writeSourcesSinksArtifact(
  cwd = process.cwd(),
  options: SourcesSinksArtifactOptions = {},
): string {
  const artifactPath = join(cwd, sourcesSinksArtifactPath);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(sourcesSinksArtifact(options), null, 2)}\n`);
  return artifactPath;
}

export function sourcesSinksExplainResult(version: string): KovoCheckResult {
  const lines = sourcesSinksTextLines(version);
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

export function sourcesSinksCheckResult(
  version: string,
  options: SourcesSinksCheckOptions = {},
): KovoCheckResult {
  const entries = frameworkSourceSinkInventory();
  const families = new Set(entries.map((entry) => sinkFamily(entry.sink)));
  const lines = sourcesSinksTextLines(version);
  if (options.driftScan) {
    const scan = options.driftScan;
    lines.push(
      `DRIFT-SCAN roots=${scan.roots.join('|')} files=${scan.totalFiles} hits=${scan.totalHits} findings=${scan.findings.length} unregistered=${scan.unregistered} status=${scan.status}`,
    );
  }
  lines.push(
    `CHECK families=${families.size} entries=${entries.length} drift-tokens=${dangerousSinkTokens().length}`,
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

export function scanSourceSinkDrift(
  cwd = process.cwd(),
  roots: readonly string[] = sourceSinkDriftRoots,
): SourceSinkDriftScanSummary {
  const findings = new Map<string, SourceSinkDriftFinding>();
  let totalFiles = 0;
  let totalHits = 0;

  for (const root of roots) {
    const absoluteRoot = join(cwd, root);
    if (!existsSync(absoluteRoot)) continue;

    for (const file of sourceFiles(absoluteRoot)) {
      totalFiles += 1;
      const text = readFileSync(file, 'utf8');
      const displayFile = relative(cwd, file).split(sep).join('/');

      for (const token of dangerousSinkTokens()) {
        const count = countOccurrences(text, token.token);
        if (count === 0) continue;

        totalHits += count;
        const key = `${token.owner}\0${token.token}\0${displayFile}`;
        findings.set(key, {
          count,
          file: displayFile,
          owner: token.owner,
          token: token.token,
        });
      }
    }
  }

  return {
    findings: [...findings.values()].sort(compareDriftFinding),
    roots,
    status: 'accounted',
    totalFiles,
    totalHits,
    unregistered: 0,
  };
}

function sourcesSinksTextLines(version: string): string[] {
  const entries = frameworkSourceSinkInventory();
  const lines = [version, 'SOURCES-SINKS'];

  for (const entry of entries) {
    lines.push(sourceSinkTextLine(entry));
  }

  for (const entry of sourceSinkRedCorpus()) {
    lines.push(sourceSinkCorpusLine(entry));
  }

  lines.push(
    `DRIFT-TOKENS ${dangerousSinkTokens()
      .map((token) => `${token.token}:${token.owner}`)
      .join(',')}`,
  );
  lines.push(`ARTIFACT ${sourcesSinksArtifactPath}`);
  lines.push(`SUMMARY total=${entries.length}`);
  return lines;
}

function sourceSinkTextLine(entry: SourceSinkInventoryEntry): string {
  return [
    'ITEM',
    `source=${entry.source}`,
    `sink=${entry.sink}`,
    `context=${entry.context}`,
    `trust=${entry.trust}`,
    `firstParser=${entry.firstParser}`,
    `consumers=${entry.consumers.join('|')}`,
    `guard=${entry.guard}`,
    `schema=${entry.schema}`,
    `runtimeGuard=${entry.runtimeGuard}`,
    `diagnostic=${entry.diagnostic}`,
    `escapeHatch=${entry.escapeHatch}`,
    `specAnchor=${entry.specAnchor}`,
    `testEvidence=${entry.testEvidence.join(',')}`,
  ].join(' ');
}

function sourceSinkCorpusLine(entry: SourceSinkCorpusEntry): string {
  return [
    'CORPUS',
    `family=${entry.family}`,
    `payloads=${entry.payloads.join('|')}`,
    `expected=${JSON.stringify(entry.expected)}`,
    `negative=${entry.negativeTestEvidence.join(',')}`,
    `positive=${entry.positiveTestEvidence.join(',')}`,
  ].join(' ');
}

function sinkFamily(sink: string): string {
  return sink.split('.')[0] ?? sink;
}

function* sourceFiles(root: string): Generator<string> {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (sourceSinkDriftIgnoredNames.has(entry.name)) continue;

    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(absolutePath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!sourceSinkDriftExtensions.has(fileExtension(entry.name))) continue;

    yield absolutePath;
  }
}

function fileExtension(file: string): string {
  const index = file.lastIndexOf('.');
  return index === -1 ? '' : file.slice(index);
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

function compareDriftFinding(a: SourceSinkDriftFinding, b: SourceSinkDriftFinding): number {
  return (
    a.owner.localeCompare(b.owner) || a.token.localeCompare(b.token) || a.file.localeCompare(b.file)
  );
}

const sourceSinkDriftRoots = ['packages', 'examples', 'site', 'tests'] as const;

const sourceSinkDriftExtensions = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const sourceSinkDriftIgnoredNames = new Set([
  '.git',
  '.kovo',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
