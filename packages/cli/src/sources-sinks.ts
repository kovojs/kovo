import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { diagnosticDefinitionText } from '@kovojs/core/internal/diagnostics';
import {
  dangerousSinkTokens as registryDangerousSinkTokens,
  frameworkSourceSinkInventory as registryFrameworkSourceSinkInventory,
  sourceSinkRedCorpus as registrySourceSinkRedCorpus,
  sourceSinkRuntimeEvidence as registrySourceSinkRuntimeEvidence,
  type DangerousSinkToken,
  type SourceSinkCorpusEntry,
  type SourceSinkInventoryEntry,
  type SourceSinkRuntimeEvidence,
} from '@kovojs/core/internal/source-sink-registry';

import { type KovoCheckResult } from './shared.js';

export const sourcesSinksArtifactVersion = 'kovo-sources-sinks/v1';
export const sourcesSinksArtifactPath = join('.kovo', 'sources-sinks.json');

export type { DangerousSinkToken, SourceSinkInventoryEntry };
export type { SourceSinkCorpusEntry };
export type { SourceSinkRuntimeEvidence };

export interface SourceSinkInventoryArtifact {
  dangerousSinkTokens: readonly DangerousSinkToken[];
  driftScan?: SourceSinkDriftScanSummary;
  entries: readonly SourceSinkInventoryEntry[];
  generatedBy: 'kovo sources-sinks inventory';
  redCorpus: readonly SourceSinkCorpusEntry[];
  runtimeEvidence: SourceSinkRuntimeEvidence;
  version: typeof sourcesSinksArtifactVersion;
}

export interface SourceSinkDriftFinding {
  count: number;
  file: string;
  owner: string;
  token: string;
}

/**
 * An unregistered dangerous-sink token (from the adversarial lexicon) observed in a framework
 * source file that is NOT mapped to a registry owner and NOT covered by the explicit
 * {@link unregisteredAllowlist}. Each one fails the KV425 drift gate (SPEC §4.8/§9.1).
 */
export interface SourceSinkUnregisteredFinding {
  count: number;
  file: string;
  token: string;
}

export interface SourceSinkDriftScanSummary {
  findings: readonly SourceSinkDriftFinding[];
  roots: readonly string[];
  status: 'accounted' | 'drift';
  totalFiles: number;
  totalHits: number;
  /** Count of distinct (token, file) hits that are unregistered and unallowlisted. */
  unregistered: number;
  /** The adversarial-lexicon hits that drive the KV425 failure (empty when accounted). */
  unregisteredFindings: readonly SourceSinkUnregisteredFinding[];
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

export function sourceSinkRuntimeEvidence(): SourceSinkRuntimeEvidence {
  return registrySourceSinkRuntimeEvidence();
}

export function sourcesSinksArtifact(
  options: SourcesSinksArtifactOptions = {},
): SourceSinkInventoryArtifact {
  const artifact: SourceSinkInventoryArtifact = {
    dangerousSinkTokens: dangerousSinkTokens(),
    entries: frameworkSourceSinkInventory(),
    generatedBy: 'kovo sources-sinks inventory',
    redCorpus: sourceSinkRedCorpus(),
    runtimeEvidence: sourceSinkRuntimeEvidence(),
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
  let failed = false;
  if (options.driftScan) {
    const scan = options.driftScan;
    lines.push(
      `DRIFT-SCAN roots=${scan.roots.join('|')} files=${scan.totalFiles} hits=${scan.totalHits} findings=${scan.findings.length} unregistered=${scan.unregistered} status=${scan.status}`,
    );
    // KV425 (audit-only, internal CI assurance): any adversarial-lexicon token in a framework
    // source file with no registry owner and no allowlist entry is unregistered drift → fail.
    for (const finding of scan.unregisteredFindings) {
      lines.push(unregisteredDriftLine(finding));
      failed = true;
    }
  }
  lines.push(
    `CHECK families=${families.size} entries=${entries.length} drift-tokens=${dangerousSinkTokens().length}`,
  );
  return { exitCode: failed ? 1 : 0, output: `${lines.join('\n')}\n` };
}

function unregisteredDriftLine(finding: SourceSinkUnregisteredFinding): string {
  return [
    `ERROR KV425 ${finding.file} token=${finding.token} count=${finding.count}`,
    diagnosticDefinitionText('KV425', { includeHelp: true }),
  ].join(' ');
}

/**
 * Adversarial source/sink drift scan (KV425, SPEC §4.8/§9.1; honesty: **audit-only**, internal
 * CI-assurance over the framework tree — not an app-facing by-construction proof).
 *
 * Two passes over framework source files:
 *
 * 1. **Accounted pass** — every {@link dangerousSinkTokens} registry entry that appears is recorded
 *    as a `finding` keyed on its declared owner. These are EXPECTED (the registry already owns them).
 *
 * 2. **Adversarial pass** — a FIXED LEXICON ({@link unregisteredSinkLexicon}) of dangerous DOM/exec
 *    tokens BROADER than the registered set (`document.write`, `vm.runInContext`,
 *    `WebAssembly.instantiate`, `setTimeout(<string>)`, `execScript`, `new Function`/`Function(`
 *    variants, …). Any lexicon token observed in a framework `*.ts(x)`/`*.js` source file that is
 *    NOT mapped to a registry owner AND NOT covered by the explicit {@link unregisteredAllowlist}
 *    (file-scoped, justified exclusions) becomes an `unregisteredFinding`. `unregistered > 0` ⇒
 *    `status:'drift'` ⇒ the KV425 renderer fails the check with a nonzero exit.
 *
 * Unlike the prior implementation (which counted only the 17 already-registered tokens and returned a
 * hardcoded `unregistered:0`, so it could never fail), this scan can structurally fail: a brand-new
 * dangerous sink token added to a framework file with no registry owner and no allowlist entry trips
 * KV425.
 */
export function scanSourceSinkDrift(
  cwd = process.cwd(),
  roots: readonly string[] = sourceSinkDriftRoots,
): SourceSinkDriftScanSummary {
  const findings = new Map<string, SourceSinkDriftFinding>();
  const unregistered = new Map<string, SourceSinkUnregisteredFinding>();
  let totalFiles = 0;
  let totalHits = 0;

  const registeredTokens = new Set(dangerousSinkTokens().map((token) => token.token));

  for (const root of roots) {
    const absoluteRoot = join(cwd, root);
    if (!existsSync(absoluteRoot)) continue;

    for (const file of sourceFiles(absoluteRoot)) {
      totalFiles += 1;
      const text = readFileSync(file, 'utf8');
      const displayFile = relative(cwd, file).split(sep).join('/');

      // Pass 1 — accounted registry tokens (expected; counted by owner).
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

      // Pass 2 — adversarial lexicon. Only the high-signal RCE/DOM-XSS surface (TS/TSX/JS code,
      // excluding the registry/diagnostics/test/fixture mention-sites already filtered by
      // `sourceFiles`/`isAdversarialScanFile`). A hit on a token with no registry owner and no
      // file-scoped allowlist entry is unregistered drift → KV425.
      if (!isAdversarialScanFile(displayFile)) continue;
      for (const lexeme of unregisteredSinkLexicon) {
        if (registeredTokens.has(lexeme.token)) continue;
        const count = lexeme.match(text);
        if (count === 0) continue;
        if (isAllowlistedSink(lexeme.token, displayFile)) continue;

        const key = `${lexeme.token}\0${displayFile}`;
        unregistered.set(key, { count, file: displayFile, token: lexeme.token });
      }
    }
  }

  const unregisteredFindings = [...unregistered.values()].sort(compareUnregisteredFinding);

  return {
    findings: [...findings.values()].sort(compareDriftFinding),
    roots,
    status: unregisteredFindings.length > 0 ? 'drift' : 'accounted',
    totalFiles,
    totalHits,
    unregistered: unregisteredFindings.length,
    unregisteredFindings,
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

  const runtime = sourceSinkRuntimeEvidence();
  for (const entry of runtime.runtimeChokepoints) {
    lines.push(
      [
        'CHOKEPOINT',
        `name=${entry.chokepoint}`,
        `guard=${entry.guard}`,
        `testEvidence=${entry.testEvidence.join(',')}`,
      ].join(' '),
    );
  }
  for (const entry of runtime.parityPairs) {
    lines.push(
      [
        'PARITY',
        `pair=${entry.pair}`,
        `claim=${entry.claim}`,
        `testEvidence=${entry.testEvidence.join(',')}`,
      ].join(' '),
    );
  }
  for (const entry of runtime.failClosedCases) {
    lines.push(
      [
        'FAIL-CLOSED',
        `shape=${entry.shape}`,
        `guard=${entry.guard}`,
        `testEvidence=${entry.testEvidence.join(',')}`,
      ].join(' '),
    );
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

function compareUnregisteredFinding(
  a: SourceSinkUnregisteredFinding,
  b: SourceSinkUnregisteredFinding,
): number {
  return a.token.localeCompare(b.token) || a.file.localeCompare(b.file);
}

/**
 * The adversarial scan restricts to code surfaces (TS/TSX/JS) and excludes inevitable
 * mention-sites: the registry/this-module themselves, the diagnostics registry (KV425's own help
 * text names these tokens), and test/fixture/test-util files (which intentionally construct hostile
 * payloads). Docs/markdown/config are likewise out of the imperative-code surface KV425 polices.
 */
function isAdversarialScanFile(displayFile: string): boolean {
  const ext = fileExtension(displayFile);
  if (!adversarialScanExtensions.has(ext)) return false;
  if (/(?:^|\/)(?:dist|node_modules)\//.test(displayFile)) return false;
  if (/\.test\.[a-z]+$|\.browser\.test\.[a-z]+$|\.spec\.[a-z]+$|\.bench\.[a-z]+$/.test(displayFile))
    return false;
  if (/(?:^|\/)__\w+\b/.test(displayFile)) return false; // __probe_*, __fixtures__, etc.
  for (const fragment of adversarialScanFileExclusions) {
    if (displayFile.includes(fragment)) return false;
  }
  return true;
}

const adversarialScanExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

/**
 * Path fragments excluded from the adversarial pass: files whose job is to *describe* dangerous
 * tokens (the registry, this scanner, the diagnostics table) or to *exercise* them (fixtures,
 * test utilities). Excluding them keeps the scan high-signal without an allowlist entry per mention.
 */
const adversarialScanFileExclusions: readonly string[] = [
  'source-sink-registry.ts',
  'sources-sinks.ts',
  '/diagnostics.ts',
  '/conformance-fixtures/',
  'fixtures.ts',
  '-fixtures.ts',
  'test-utils',
  'test-util',
  '-harness.', // example/integration test harnesses (e.g. interactive-gallery-harness)
  '.fixture.',
  '/test/src/', // @kovojs/test harness (test-only db/vm wiring)
];

/**
 * One token in the adversarial lexicon. `token` is the stable label (used for allowlist matching and
 * the KV425 line); `match(text)` returns the occurrence count. Most tokens are plain substrings; a
 * few (string-arg `setTimeout`/`setInterval`, `Function(` constructor) need a regex so a benign
 * function-reference use is not flagged.
 */
interface UnregisteredSinkLexeme {
  match: (text: string) => number;
  token: string;
}

function substringLexeme(token: string): UnregisteredSinkLexeme {
  return { match: (text) => countOccurrences(text, token), token };
}

function regexLexeme(token: string, pattern: RegExp): UnregisteredSinkLexeme {
  return {
    match: (text) => {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let count = 0;
      while (re.exec(text) !== null) count += 1;
      return count;
    },
    token,
  };
}

/**
 * FIXED LEXICON of dangerous DOM/exec sink tokens — deliberately BROADER than the 17 registered
 * `dangerousSinkTokens` (which the accounted pass owns). These are the canonical RCE / DOM-XSS /
 * dynamic-code-evaluation sinks an attacker would reach for; a framework file using one of them
 * without a registry owner or allowlist entry is exactly the drift KV425 exists to catch.
 */
const unregisteredSinkLexicon: readonly UnregisteredSinkLexeme[] = [
  // DOM HTML injection (document-level, distinct from the registered element.innerHTML token).
  substringLexeme('document.write'),
  substringLexeme('document.writeln'),
  // node:vm dynamic-code evaluation surface.
  substringLexeme('vm.runInContext'),
  substringLexeme('runInNewContext'),
  substringLexeme('runInThisContext'),
  substringLexeme('vm.compileFunction'),
  substringLexeme('compileFunction('),
  // WebAssembly code instantiation from bytes.
  substringLexeme('WebAssembly.instantiate'),
  substringLexeme('WebAssembly.compile'),
  // Legacy/obscure script execution.
  substringLexeme('execScript'),
  // `Function(...)` and `new Function(...)` constructors (string→code). The bare registered token is
  // `new Function`; `Function(` also catches `globalThis.Function(...)`/aliased construction.
  regexLexeme('Function(', /\bFunction\s*\(/),
  // String-argument timers (`setTimeout('code', …)` / `setInterval('code', …)`) — implicit eval.
  regexLexeme('setTimeout(<string>)', /\bsetTimeout\s*\(\s*['"`]/),
  regexLexeme('setInterval(<string>)', /\bsetInterval\s*\(\s*['"`]/),
  // Direct global eval references beyond the registered `eval(` token.
  substringLexeme('globalThis.eval'),
  substringLexeme('window.eval'),
  // Node internals reachable for native-code / module forging.
  substringLexeme('process.binding'),
];

/**
 * Explicit, file-scoped allowlist of legitimate framework uses of an adversarial-lexicon token,
 * each with a justification. An entry suppresses KV425 for that exact (token, file) pair. Adding a
 * new dangerous-sink use to a framework file therefore REQUIRES either a registry owner or a
 * justified entry here — that is the contributor-facing gate.
 */
interface SinkAllowlistEntry {
  file: string;
  justification: string;
  token: string;
}

const unregisteredAllowlist: readonly SinkAllowlistEntry[] = [
  {
    file: 'packages/server/src/vite-dev.ts',
    justification:
      'Dev-only Vite HTML transform shim writes the transformed index document; not a request-path sink in production builds.',
    token: 'document.write',
  },
  {
    file: 'packages/compiler/src/vite.ts',
    justification:
      'Compile-time render-equivalence harness evaluates the framework-emitted server module in a sandboxed node:vm context (timeout-bounded); input is framework-generated code, not request data.',
    token: 'runInNewContext',
  },
  {
    file: 'packages/compiler/src/emit/render-equivalence.ts',
    justification:
      'Compile-time render-equivalence check evaluates framework-emitted source in a sandboxed node:vm context to prove server/client render parity; input is framework-generated code.',
    token: 'runInNewContext',
  },
];

function isAllowlistedSink(token: string, displayFile: string): boolean {
  for (const entry of unregisteredAllowlist) {
    if (entry.token === token && entry.file === displayFile) return true;
  }
  return false;
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
