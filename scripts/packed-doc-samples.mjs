#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';
import { generateApiReference } from '../site/scripts/api-ref.mjs';
import { writeAuthoredSnippetSupportFiles } from '../site/scripts/code-snippets-check.mjs';

const DEFAULT_PACKED_MANIFEST = path.join(repoRoot, '.release/packed-packages.json');
const POLICY_PATH = path.join(repoRoot, 'site/code-sample-policy.json');
const SAMPLE_CLASSES = new Set(['executable', 'illustrative', 'output', 'type-error']);
const TYPESCRIPT_LANGUAGES = new Set(['js', 'ts', 'tsx']);
const SHELL_LANGUAGES = new Set(['bash', 'sh']);
const DIRECTIVE_TOKEN = 'kovo-sample:';
const HTML_DIRECTIVE =
  /^<!--\s*kovo-sample:\s*(executable|illustrative|output|type-error)(?:\s+reason="([^"]+)")?\s*-->$/u;
const CODE_DIRECTIVE =
  /^\s*(?:\/\/|#)\s*kovo-sample:\s*(executable|illustrative|output|type-error)(?:\s+reason="([^"]+)")?\s*$/u;
const KOVO_PACKAGE = /^@kovojs\/[a-z0-9-]+(?:\/.*)?$/u;
const SOURCE_PROVENANCE =
  /^\/\/\s*Source(?::\s*(.+)|-verified\s+(?:shape|runtime refusal)\s+from\s+(.+))$/u;
const VALUE_KINDS = new Set(['class', 'const', 'enum', 'function']);

export function loadCodeSamplePolicy(policyPath = POLICY_PATH) {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (policy?.schema !== 'kovo.doc-sample-policy/v1') {
    throw new TypeError(`${path.relative(repoRoot, policyPath)}: unsupported code-sample policy`);
  }
  if (!policy.languages || typeof policy.languages !== 'object') {
    throw new TypeError(`${path.relative(repoRoot, policyPath)}: missing languages map`);
  }
  for (const [language, rule] of Object.entries(policy.languages)) {
    assertClassification(rule, `language ${language}`);
  }
  for (const [name, rule] of Object.entries(policy.reviewedSkips ?? {})) {
    assertClassification(rule, `reviewed skip ${name}`);
    if (rule.class !== 'illustrative' || !rule.reason?.trim()) {
      throw new TypeError(`reviewed skip ${name}: illustrative skips require a reason`);
    }
  }
  for (const [packageName, exclusion] of Object.entries(policy.readmeExclusions ?? {})) {
    if (typeof exclusion?.reason !== 'string' || exclusion.reason.trim() === '') {
      throw new TypeError(`README exclusion ${packageName}: missing reviewed reason`);
    }
  }
  return policy;
}

function assertClassification(rule, label) {
  if (!rule || typeof rule !== 'object' || !SAMPLE_CLASSES.has(rule.class)) {
    throw new TypeError(`${label}: invalid sample class`);
  }
  if (rule.class === 'illustrative' && !rule.reason?.trim()) {
    throw new TypeError(`${label}: illustrative samples require a reviewed reason`);
  }
}

export function scanMarkdownSamples(
  markdown,
  { origin, policy = loadCodeSamplePolicy(), sourcePath } = {},
) {
  if (typeof origin !== 'string' || typeof sourcePath !== 'string') {
    throw new TypeError('markdown sample scan requires origin and sourcePath');
  }
  const lines = markdown.split('\n');
  const samples = [];
  const consumedHtmlDirectives = new Set();
  let open;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!open) {
      const fence = /^(\s*)(`{3,}|~{3,})(.*)$/u.exec(line);
      if (!fence) continue;
      const marker = fence[2][0];
      const info = fence[3].trim();
      if (info.includes(marker)) {
        throw sampleError(sourcePath, index + 1, 'code fence info contains its fence marker');
      }
      if (!/^[A-Za-z0-9_-]+$/u.test(info)) {
        throw sampleError(sourcePath, index + 1, 'code fences require one policy-owned language');
      }
      const directiveIndex = previousNonblankIndex(lines, index - 1);
      let directive;
      if (directiveIndex >= 0 && lines[directiveIndex].includes(DIRECTIVE_TOKEN)) {
        directive = parseHtmlDirective(lines[directiveIndex], sourcePath, directiveIndex + 1);
        consumedHtmlDirectives.add(directiveIndex);
      }
      open = {
        body: [],
        directive,
        fenceLength: fence[2].length,
        fenceMarker: marker,
        language: info.toLowerCase(),
        line: index + 1,
        previous: previousNonblankLine(lines, (directive ? directiveIndex : index) - 1),
      };
      continue;
    }

    const fenceMarker = open.fenceMarker === '`' ? '`' : '~';
    const close = new RegExp(`^\\s*${fenceMarker}{${open.fenceLength},}\\s*$`, 'u');
    if (!close.test(line)) {
      open.body.push(line);
      continue;
    }

    samples.push(
      classifyMarkdownFence({
        ...open,
        origin,
        policy,
        sourcePath,
      }),
    );
    open = undefined;
  }

  if (open) {
    throw sampleError(sourcePath, open.line, 'unclosed code fence');
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(DIRECTIVE_TOKEN)) continue;
    if (consumedHtmlDirectives.has(index)) continue;
    if (insideSampleBody(samples, index + 1)) continue;
    throw sampleError(sourcePath, index + 1, 'orphan or malformed sample directive');
  }
  return samples;
}

function insideSampleBody(samples, line) {
  return samples.some(
    (sample) =>
      line > sample.startLine && line < sample.endLine && sample.inlineDirectiveLine === line,
  );
}

function parseHtmlDirective(line, sourcePath, lineNumber) {
  const match = HTML_DIRECTIVE.exec(line);
  if (!match) throw sampleError(sourcePath, lineNumber, 'malformed sample directive');
  return directiveValue(match[1], match[2], sourcePath, lineNumber);
}

function parseCodeDirective(line, sourcePath, lineNumber) {
  const match = CODE_DIRECTIVE.exec(line);
  if (!match) throw sampleError(sourcePath, lineNumber, 'malformed sample directive');
  return directiveValue(match[1], match[2], sourcePath, lineNumber);
}

function directiveValue(classification, reason, sourcePath, lineNumber) {
  if (classification === 'illustrative' && !reason?.trim()) {
    throw sampleError(sourcePath, lineNumber, 'illustrative sample directive requires reason="…"');
  }
  if (classification !== 'illustrative' && reason !== undefined) {
    throw sampleError(sourcePath, lineNumber, 'only illustrative samples accept a skip reason');
  }
  return { class: classification, ...(reason ? { reason } : {}) };
}

function classifyMarkdownFence({
  body,
  directive,
  language,
  line,
  origin,
  policy,
  previous,
  sourcePath,
}) {
  const firstContentIndex = body.findIndex((entry) => entry.trim() !== '');
  let inlineDirective;
  if (firstContentIndex >= 0 && body[firstContentIndex].includes(DIRECTIVE_TOKEN)) {
    inlineDirective = parseCodeDirective(
      body[firstContentIndex],
      sourcePath,
      line + firstContentIndex + 1,
    );
    body = body.filter((_, index) => index !== firstContentIndex);
  }
  for (let index = 0; index < body.length; index += 1) {
    if (!body[index].includes(DIRECTIVE_TOKEN)) continue;
    throw sampleError(sourcePath, line + index + 1, 'sample directive must be the first code line');
  }
  if (directive && inlineDirective) {
    throw sampleError(sourcePath, line, 'sample has both HTML and code directives');
  }

  const policyRule = classificationRule({
    body,
    directive: directive ?? inlineDirective,
    language,
    origin,
    policy,
    previous,
    sourcePath,
    line,
  });
  const endLine = line + body.length + 1;
  const code = body.join('\n').replace(/\s+$/u, '');
  if ((policyRule.class === 'executable' || policyRule.class === 'type-error') && code === '') {
    throw sampleError(sourcePath, line, `${policyRule.class} sample is empty`);
  }
  return {
    class: policyRule.class,
    code,
    endLine,
    id: stableSampleId(sourcePath, line),
    language,
    origin:
      origin === 'generated-api' && previous === '**Example**' ? 'generated-api/jsdoc' : origin,
    ...(policyRule.reason ? { reason: policyRule.reason } : {}),
    ...(inlineDirective ? { inlineDirectiveLine: line + firstContentIndex + 1 } : {}),
    sourcePath,
    startLine: line,
    validator: policyRule.validator ?? 'none',
  };
}

function classificationRule({
  body,
  directive,
  language,
  origin,
  policy,
  previous,
  sourcePath,
  line,
}) {
  if (directive)
    return { ...directive, validator: validatorFor(language, directive.class, policy) };
  const first = body.find((entry) => entry.trim() !== '')?.trim() ?? '';
  if (SOURCE_PROVENANCE.test(first)) {
    return policy.reviewedSkips['source-provenance'];
  }
  if (origin === 'generated-api') {
    if (previous !== '**Example**') return policy.reviewedSkips['generated-signature'];
  }
  const rule = policy.languages[language];
  if (!rule) throw sampleError(sourcePath, line, `unclassified code-fence language ${language}`);
  if (language === 'text' && looksLikeSourceCode(body.join('\n'))) {
    throw sampleError(
      sourcePath,
      line,
      'code-shaped text fence requires its real language or an explicit illustrative directive',
    );
  }
  return rule;
}

function looksLikeSourceCode(source) {
  return /^\s*(?:\/[/*]|import\b|export\b|(?:async\s+)?function\b|(?:const|let|var|type|interface|class|enum)\b|createApp\s*\(|kovo\s*\(|<[A-Za-z][^>]*>)/u.test(
    source,
  );
}

function validatorFor(language, classification, policy) {
  if (classification === 'illustrative' || classification === 'output') return 'none';
  return policy.languages[language]?.validator ?? 'none';
}

function previousNonblankLine(lines, start) {
  const index = previousNonblankIndex(lines, start);
  return index >= 0 ? lines[index].trim() : '';
}

function previousNonblankIndex(lines, start) {
  for (let index = start; index >= 0; index -= 1) {
    if (lines[index].trim() !== '') return index;
  }
  return -1;
}

function sampleError(sourcePath, line, message) {
  return new TypeError(`${sourcePath}:${line} ${message}`);
}

function stableSampleId(sourcePath, line) {
  const readable = sourcePath
    .replace(/\.[^.]+$/u, '')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(-100);
  return `${readable || 'sample'}-L${line}-${sha256(`${sourcePath}:${line}`).slice(0, 10)}`;
}

export function tokenizeShell(source, label = 'shell sample') {
  const tokens = [];
  let token = '';
  let quote = '';
  let escaping = false;
  const push = () => {
    if (token !== '') tokens.push(token);
    token = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#') break;
    if (/\s/u.test(character)) {
      push();
      continue;
    }
    if ('|;&<>'.includes(character)) {
      push();
      const next = source[index + 1];
      if (next === character || (character === '>' && next === '>')) {
        tokens.push(`${character}${next}`);
        index += 1;
      } else {
        tokens.push(character);
      }
      continue;
    }
    token += character;
  }
  if (quote) throw new TypeError(`${label}: unterminated ${quote} quote`);
  if (escaping) throw new TypeError(`${label}: dangling shell escape`);
  push();
  return tokens;
}

export function extractKovoInvocations(shellSource, label = 'shell sample') {
  const invocations = [];
  for (const [line, logicalLine] of logicalShellLines(shellSource, label).entries()) {
    const tokens = tokenizeShell(logicalLine, `${label}:${line + 1}`);
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== 'kovo' || !isKovoExecutableToken(tokens, index)) continue;
      invocations.push({ argv: invocationArgs(tokens, index + 1), line: line + 1 });
    }
  }
  return invocations;
}

export function extractCreateKovoInvocations(shellSource, label = 'shell sample') {
  const invocations = [];
  for (const [line, logicalLine] of logicalShellLines(shellSource, label).entries()) {
    const tokens = tokenizeShell(logicalLine, `${label}:${line + 1}`);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const direct = isCreateKovoPackageToken(token) && isCreateKovoExecutableToken(tokens, index);
      const createWrapper =
        isKovoCreateTargetToken(token) &&
        ['create', 'init'].includes(tokens[index - 1]) &&
        ['npm', 'pnpm', 'yarn', 'bun'].includes(tokens[index - 2]);
      if (!direct && !createWrapper) continue;
      const argv = invocationArgs(tokens, index + 1);
      const separator = argv.indexOf('--');
      if (separator >= 0) argv.splice(separator, 1);
      invocations.push({ argv, line: line + 1 });
    }
  }
  return invocations;
}

function logicalShellLines(shellSource, label) {
  const logicalLines = [];
  let current = '';
  for (const rawLine of shellSource.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/\\\s*$/u.test(rawLine)) {
      current += `${rawLine.replace(/\\\s*$/u, '')} `;
      continue;
    }
    logicalLines.push(`${current}${rawLine}`);
    current = '';
  }
  if (current !== '') throw new TypeError(`${label}: dangling line continuation`);
  return logicalLines;
}

function invocationArgs(tokens, start) {
  const argv = [];
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    if (['|', '||', '&', '&&', ';', '<', '>', '>>'].includes(tokens[cursor])) break;
    argv.push(tokens[cursor]);
  }
  return argv;
}

function isKovoExecutableToken(tokens, index) {
  if (index === 0) return true;
  const previous = tokens[index - 1];
  if (['|', '||', '&', '&&', ';'].includes(previous)) return true;
  if (previous === 'npx' || previous === 'bunx') return true;
  if (previous === 'exec' && ['npm', 'pnpm', 'yarn', 'bun'].includes(tokens[index - 2])) {
    return true;
  }
  const segmentStart =
    Math.max(
      tokens.lastIndexOf('|', index - 1),
      tokens.lastIndexOf('||', index - 1),
      tokens.lastIndexOf('&', index - 1),
      tokens.lastIndexOf('&&', index - 1),
      tokens.lastIndexOf(';', index - 1),
    ) + 1;
  const prefix = tokens.slice(segmentStart, index);
  const assignments = prefix[0] === 'env' ? prefix.slice(1) : prefix;
  return (
    assignments.length > 0 && assignments.every((token) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token))
  );
}

function isCreateKovoExecutableToken(tokens, index) {
  if (isKovoExecutableToken(tokens, index)) return true;
  return tokens[index - 1] === 'dlx' && tokens[index - 2] === 'pnpm';
}

function isCreateKovoPackageToken(token) {
  return /^create-kovo(?:@[^/]+)?$/u.test(token);
}

function isKovoCreateTargetToken(token) {
  return /^kovo(?:@[^/]+)?$/u.test(token);
}

export async function validateKovoInvocations(samples) {
  registerTypeScriptSourceResolution();
  const { parseKovoCommandInvocation, parseKovoMetaInvocation, resolveCommand } =
    await import('../packages/cli/src/commands-manifest.ts');
  const { assertCreateKovoSqliteScaffoldAllowed, readCreateKovoCliOptions } =
    await import('../packages/create-kovo/src/cli-schema.ts');
  let count = 0;
  for (const sample of samples) {
    if (sample.class !== 'executable' || !SHELL_LANGUAGES.has(sample.language)) continue;
    const invocations = extractKovoInvocations(
      sample.code,
      `${sample.sourcePath}:${sample.startLine}`,
    );
    for (const invocation of invocations) {
      const command = resolveCommand(invocation.argv[0]);
      if (command) {
        const parsed = parseKovoCommandInvocation(command.name, invocation.argv.slice(1));
        if (!parsed.ok) {
          throw sampleError(
            sample.sourcePath,
            sample.startLine + invocation.line,
            `documented kovo invocation contradicts command schema: ${parsed.message.trim()}`,
          );
        }
      } else {
        const parsed = parseKovoMetaInvocation(invocation.argv);
        if (!parsed.ok || !parsed.handled) {
          throw sampleError(
            sample.sourcePath,
            sample.startLine + invocation.line,
            `documented kovo invocation is not in the command schema`,
          );
        }
      }
      count += 1;
    }
    const createInvocations = extractCreateKovoInvocations(
      sample.code,
      `${sample.sourcePath}:${sample.startLine}`,
    );
    for (const invocation of createInvocations) {
      try {
        if (
          invocation.argv.length === 1 &&
          (invocation.argv[0] === '--help' || invocation.argv[0] === '-h')
        ) {
          count += 1;
          continue;
        }
        const options = readCreateKovoCliOptions(invocation.argv);
        assertCreateKovoSqliteScaffoldAllowed(options, {
          experimentalSqliteEnvironment: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw sampleError(
          sample.sourcePath,
          sample.startLine + invocation.line,
          `documented create-kovo invocation contradicts command schema: ${message}`,
        );
      }
      count += 1;
    }
  }
  return count;
}

let sourceResolutionHook;

function registerTypeScriptSourceResolution() {
  if (sourceResolutionHook) return;
  sourceResolutionHook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const sourceUrl = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
        if (existsSync(sourceUrl)) return nextResolve(sourceUrl.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

export function validateAuxiliarySamples(samples, policy) {
  for (const sample of samples) {
    if (
      (sample.class === 'executable' || sample.class === 'type-error') &&
      sample.validator === 'none'
    ) {
      throw sampleError(
        sample.sourcePath,
        sample.startLine,
        `${sample.class} sample has no validating runner`,
      );
    }
    if (
      sample.origin === 'generated-api' &&
      sample.reason === policy.reviewedSkips['generated-signature'].reason
    ) {
      assertTypescriptSyntax(sample);
    }
    if (sample.reason === policy.reviewedSkips['source-provenance'].reason) {
      assertTrackedSourceProvenance(sample);
    }
    if (sample.class !== 'executable') continue;
    if (sample.validator === 'jsonc') {
      const parsed = ts.parseConfigFileTextToJson(`${sample.id}.jsonc`, sample.code);
      if (parsed.error) {
        throw sampleError(sample.sourcePath, sample.startLine, 'invalid JSONC sample');
      }
    }
    if (sample.validator === 'dotenv') {
      for (const [index, line] of sample.code.split('\n').entries()) {
        if (line.trim() === '' || line.trim().startsWith('#')) continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]*=.*$/u.test(line.trim())) {
          throw sampleError(
            sample.sourcePath,
            sample.startLine + index + 1,
            'invalid dotenv assignment',
          );
        }
      }
    }
  }
}

function assertTypescriptSyntax(sample) {
  const attempts = [ts.ScriptKind.TS, ts.ScriptKind.TSX].map((kind) =>
    ts.createSourceFile(
      `${sample.id}.${kind === ts.ScriptKind.TSX ? 'tsx' : 'ts'}`,
      sample.code,
      ts.ScriptTarget.Latest,
      true,
      kind,
    ),
  );
  if (attempts.some((sourceFile) => sourceFile.parseDiagnostics.length === 0)) return;
  const diagnostic = attempts[0].parseDiagnostics[0];
  throw sampleError(
    sample.sourcePath,
    sample.startLine,
    `generated signature is not valid TypeScript: ${ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      ' ',
    )}`,
  );
}

function assertTrackedSourceProvenance(sample) {
  const first =
    sample.code
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  const match = SOURCE_PROVENANCE.exec(first);
  if (!match) {
    throw sampleError(
      sample.sourcePath,
      sample.startLine,
      'reviewed source skip has no source path',
    );
  }
  const rawPaths = (match[1] ?? match[2])
    .split(/\s+and\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  let previousDirectory = repoRoot;
  for (const [index, rawPath] of rawPaths.entries()) {
    const candidate =
      index > 0 && !rawPath.includes('/')
        ? path.join(previousDirectory, rawPath)
        : path.resolve(repoRoot, rawPath);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw sampleError(
        sample.sourcePath,
        sample.startLine,
        `reviewed source path does not exist: ${path.relative(repoRoot, candidate)}`,
      );
    }
    const relative = path.relative(repoRoot, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw sampleError(
        sample.sourcePath,
        sample.startLine,
        `reviewed source path escapes the repository: ${candidate}`,
      );
    }
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (tracked.status !== 0) {
      throw sampleError(
        sample.sourcePath,
        sample.startLine,
        `reviewed source path is not tracked: ${relative}`,
      );
    }
    previousDirectory = path.dirname(candidate);
  }
}

export async function materializePackedPackages({ manifestPath, nodeModulesDir }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest?.schema !== 'kovo.packed-public-packages/v2' || !Array.isArray(manifest.packages)) {
    throw new TypeError(`${manifestPath}: unsupported packed package manifest`);
  }
  const names = manifest.packages.map((entry) => entry?.name);
  if (names.some((name) => typeof name !== 'string')) {
    throw new TypeError(`${manifestPath}: malformed packed package name`);
  }
  if (new Set(names).size !== names.length) {
    throw new TypeError(`${manifestPath}: duplicate packed package rows`);
  }
  const expectedNames = publicPackages()
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const actualNames = [...names].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new TypeError(`${manifestPath}: packed package set differs from public-packages.json`);
  }
  await mkdir(nodeModulesDir, { recursive: true });
  const packageDirs = new Map();
  for (const packedPackage of manifest.packages) {
    if (
      typeof packedPackage.name !== 'string' ||
      typeof packedPackage.sha512 !== 'string' ||
      !Array.isArray(packedPackage.files)
    ) {
      throw new TypeError(`${manifestPath}: malformed packed package row`);
    }
    const tarballPath = resolvePackedTarball(manifestPath, packedPackage.tarball);
    const bytes = readPackageTarballSnapshot(tarballPath);
    const actualSha = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (actualSha !== packedPackage.sha512) {
      throw new TypeError(`${packedPackage.name}: packed tarball digest mismatch`);
    }
    const entries = validatedPackageTarballEntries(bytes);
    const names = entries.map((entry) => entry.name);
    if (JSON.stringify(names) !== JSON.stringify(packedPackage.files)) {
      throw new TypeError(`${packedPackage.name}: packed file census mismatch`);
    }
    const packageDir = path.join(nodeModulesDir, ...packedPackage.name.split('/'));
    for (const entry of entries) {
      const relative = entry.name.slice('package/'.length);
      const destination = path.join(packageDir, ...relative.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, entry.data, { mode: entry.executable ? 0o755 : 0o644 });
      if (entry.executable) chmodSync(destination, 0o755);
    }
    const materializedManifest = JSON.parse(
      await readFile(path.join(packageDir, 'package.json'), 'utf8'),
    );
    if (
      materializedManifest.name !== packedPackage.name ||
      materializedManifest.version !== packedPackage.version
    ) {
      throw new TypeError(`${packedPackage.name}: materialized manifest identity mismatch`);
    }
    packageDirs.set(packedPackage.name, packageDir);
  }
  return { manifest, packageDirs };
}

function resolvePackedTarball(manifestPath, recordedPath) {
  if (typeof recordedPath !== 'string') {
    throw new TypeError(`${manifestPath}: packed row has no tarball path`);
  }
  const candidates = [
    path.resolve(repoRoot, recordedPath),
    path.join(path.dirname(manifestPath), 'tarballs', path.basename(recordedPath)),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new TypeError(`${recordedPath}: packed tarball is missing`);
  return found;
}

async function linkExternalDependencies(nodeModulesDir, packedNames) {
  const sourceRoots = await workspaceNodeModulesDirectories();
  if (sourceRoots.length === 0)
    throw new TypeError('workspace node_modules directories are missing');
  for (const sourceRoot of sourceRoots) {
    for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '@kovojs') continue;
      const source = path.join(sourceRoot, entry.name);
      if (entry.name.startsWith('@')) {
        await mkdir(path.join(nodeModulesDir, entry.name), { recursive: true });
        for (const child of await readdir(source, { withFileTypes: true })) {
          const name = `${entry.name}/${child.name}`;
          const destination = path.join(nodeModulesDir, entry.name, child.name);
          if (packedNames.has(name) || existsSync(destination)) continue;
          await symlink(path.join(source, child.name), destination);
        }
        continue;
      }
      const destination = path.join(nodeModulesDir, entry.name);
      if (packedNames.has(entry.name) || existsSync(destination)) continue;
      await symlink(source, destination);
    }
  }
}

async function workspaceNodeModulesDirectories() {
  const roots = [path.join(repoRoot, 'node_modules')];
  for (const workspaceParent of ['packages', 'examples', 'conformance']) {
    const parent = path.join(repoRoot, workspaceParent);
    if (!existsSync(parent)) continue;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      roots.push(path.join(parent, entry.name, 'node_modules'));
    }
  }
  roots.push(path.join(repoRoot, 'site/node_modules'));
  roots.push(path.join(repoRoot, 'tests/integration/node_modules'));
  return roots.filter((root) => existsSync(root) && statSync(root).isDirectory());
}

function workspaceReadmeSamples(packageDirs, policy) {
  const samples = [];
  for (const [packageName, packageDir] of [...packageDirs].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const packedReadme = path.join(packageDir, 'README.md');
    if (!existsSync(packedReadme)) {
      if (!policy.readmeExclusions?.[packageName]) {
        throw new TypeError(`${packageName}: packed package has no README or reviewed exclusion`);
      }
      continue;
    }
    if (policy.readmeExclusions?.[packageName]) {
      throw new TypeError(`${packageName}: stale README exclusion; packed README now exists`);
    }
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const sourceDir =
      packageName === 'create-kovo'
        ? path.join(repoRoot, 'packages/create-kovo')
        : path.join(repoRoot, 'packages', packageName.slice('@kovojs/'.length));
    const sourceReadme = path.join(sourceDir, 'README.md');
    if (!existsSync(sourceReadme)) {
      throw new TypeError(`${packageName}: packed README has no reviewed workspace source`);
    }
    const packedBytes = readFileSync(packedReadme);
    if (!packedBytes.equals(readFileSync(sourceReadme))) {
      throw new TypeError(`${packageName}: packed README differs from workspace README`);
    }
    samples.push(
      ...scanMarkdownSamples(packedBytes.toString('utf8'), {
        origin: 'package-readme',
        policy,
        sourcePath: path.relative(repoRoot, sourceReadme),
      }),
    );
    if (manifest.name !== packageName) throw new TypeError(`${packageName}: README owner drift`);
  }
  return samples;
}

async function authoredGuideSamples(policy) {
  const contentDir = path.join(repoRoot, 'site/content');
  const samples = [];
  for (const file of await markdownFiles(contentDir)) {
    samples.push(
      ...scanMarkdownSamples(await readFile(file, 'utf8'), {
        origin: 'authored-guide',
        policy,
        sourcePath: path.relative(repoRoot, file),
      }),
    );
  }
  return samples;
}

async function generatedApiSamples(policy, outDir) {
  const generated = await generateApiReference({ outDir });
  const samples = [];
  for (const file of await markdownFiles(outDir)) {
    const source = await readFile(file, 'utf8');
    const sourcePath = `generated-api/${path.basename(file)}`;
    const pageSamples = scanMarkdownSamples(source, {
      origin: 'generated-api',
      policy,
      sourcePath,
    });
    const exampleMarkers = source
      .split('\n')
      .filter((line) => line.trim() === '**Example**').length;
    const examples = pageSamples.filter((sample) => sample.origin === 'generated-api/jsdoc').length;
    if (exampleMarkers !== examples) {
      throw new TypeError(
        `${sourcePath}: generated ${exampleMarkers} JSDoc example markers but classified ${examples}`,
      );
    }
    samples.push(...pageSamples);
  }
  const signatureCount = samples.filter(
    (sample) =>
      sample.origin === 'generated-api' &&
      sample.reason === policy.reviewedSkips['generated-signature'].reason,
  ).length;
  if (signatureCount !== generated.exports) {
    throw new TypeError(
      `generated-api: generated ${generated.exports} exports but classified ${signatureCount} signatures`,
    );
  }
  return { generated, samples };
}

async function markdownFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(file)));
    else if (entry.name.endsWith('.md')) files.push(file);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function assertUniqueSamples(samples) {
  const ids = new Set();
  for (const sample of samples) {
    if (ids.has(sample.id)) {
      throw sampleError(sample.sourcePath, sample.startLine, `duplicate sample id ${sample.id}`);
    }
    ids.add(sample.id);
    assertClassification(sample, `${sample.sourcePath}:${sample.startLine}`);
  }
}

async function writeTypescriptSamples(
  projectDir,
  samples,
  { authoredSupport, generatedPackages = [] },
) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'package.json'), '{"private":true,"type":"module"}\n');
  if (authoredSupport) {
    await writeAuthoredSnippetSupportFiles(projectDir, { includeNodeModuleStubs: false });
    await bindAmbientFrameworkGlobals(projectDir, generatedPackages);
  }
  const written = [];
  for (const sample of samples) {
    if (!TYPESCRIPT_LANGUAGES.has(sample.language)) continue;
    if (sample.class !== 'executable' && sample.class !== 'type-error') continue;
    const extension =
      sample.language === 'tsx' || looksLikeJsx(sample.code) ? 'tsx' : sample.language;
    const source = normalizeModuleSample(sample.code);
    const file = path.join(projectDir, `${sample.id}.${extension}`);
    await writeFile(file, source, 'utf8');
    written.push({ ...sample, file });
  }
  if (written.length === 0)
    throw new TypeError(`${projectDir}: no TypeScript samples were written`);
  return written;
}

async function bindAmbientFrameworkGlobals(projectDir, generatedPackages) {
  const exportsByName = new Map();
  for (const pkg of generatedPackages) {
    for (const subpath of pkg.symbolsBySubpath ?? []) {
      for (const symbol of subpath.symbols) {
        if (!VALUE_KINDS.has(symbol.kind) || exportsByName.has(symbol.name)) continue;
        exportsByName.set(symbol.name, subpath.importPath);
      }
    }
  }
  const preludePath = path.join(projectDir, 'snippet-prelude.d.ts');
  let prelude = await readFile(preludePath, 'utf8');
  const bindings = [];
  prelude = prelude.replace(
    /^  var ([A-Za-z_$][A-Za-z0-9_$]*):[\s\S]*?;\n/gmu,
    (declaration, name) => {
      const importPath = exportsByName.get(name);
      if (!importPath) return declaration;
      bindings.push({ importPath, name });
      return '';
    },
  );
  if (bindings.length === 0) {
    throw new TypeError('authored sample prelude did not bind any packed framework globals');
  }
  const bridge = [
    '',
    'declare global {',
    ...bindings.map(
      ({ importPath, name }) =>
        `  var ${name}: typeof import(${JSON.stringify(importPath)}).${name};`,
    ),
    '}',
    '',
    'export {};',
    '',
  ].join('\n');
  await writeFile(preludePath, `${prelude.trimEnd()}\n${bridge}`, 'utf8');
}

async function writePackedApiBindings(projectDir, generatedPackages) {
  const bindings = [];
  for (const pkg of generatedPackages) {
    for (const [index, subpath] of (pkg.symbolsBySubpath ?? []).entries()) {
      const names = [...new Set(subpath.symbols.map((symbol) => symbol.name))];
      if (names.length === 0) continue;
      const id = stableSampleId(`packed-api/${subpath.importPath}`, index + 1);
      const file = path.join(projectDir, `${id}.ts`);
      const imports = names.map((name, symbolIndex) => `  ${name} as Export${symbolIndex},`);
      await writeFile(
        file,
        [
          `import type {`,
          ...imports,
          `} from ${JSON.stringify(subpath.importPath)};`,
          '',
          'export {};',
          '',
        ].join('\n'),
        'utf8',
      );
      bindings.push({
        class: 'executable',
        code: '',
        file,
        id,
        language: 'ts',
        origin: 'generated-api/binding',
        sourcePath: `packed-api/${subpath.importPath}`,
        startLine: 1,
        validator: 'typescript',
      });
    }
  }
  if (bindings.length === 0)
    throw new TypeError('generated API produced no packed export bindings');
  return bindings;
}

function normalizeModuleSample(code) {
  const trimmed = code.replace(/\s+$/u, '');
  if (/^\s*(?:import|export)\b/mu.test(trimmed)) return `${trimmed}\n`;
  return `${trimmed}\n\nexport {};\n`;
}

function looksLikeJsx(code) {
  return /<[A-Za-z][\w.:-]*(?:\s|>|\/>)/u.test(code);
}

async function compileTypescriptProject(projectDir, written, nodeModulesDir) {
  const executable = written.filter((sample) => sample.class === 'executable');
  const expectedErrors = written.filter((sample) => sample.class === 'type-error');
  const supportFiles = ['snippet-prelude.d.ts'].filter((file) =>
    existsSync(path.join(projectDir, file)),
  );
  const supportWitnesses = supportFiles.map((file) => ({
    file: path.join(projectDir, file),
    sourcePath: `sample-support/${file}`,
    startLine: 1,
  }));
  const config = {
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      exactOptionalPropertyTypes: false,
      jsx: 'preserve',
      jsxImportSource: '@kovojs/server',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      noImplicitAny: false,
      noUncheckedIndexedAccess: false,
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      types: ['node'],
      verbatimModuleSyntax: true,
    },
    files: [...supportFiles, ...executable.map((sample) => path.relative(projectDir, sample.file))],
  };
  const configPath = path.join(projectDir, 'tsconfig.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  runTypecheck(configPath, true);
  assertPackedKovoResolutions(
    [...executable, ...supportWitnesses],
    projectDir,
    nodeModulesDir,
    config.compilerOptions,
  );

  for (const sample of expectedErrors) {
    const errorConfig = {
      ...config,
      files: [...supportFiles, path.relative(projectDir, sample.file)],
    };
    const errorConfigPath = path.join(projectDir, `tsconfig.${sample.id}.json`);
    await writeFile(errorConfigPath, `${JSON.stringify(errorConfig, null, 2)}\n`, 'utf8');
    runTypecheck(errorConfigPath, false);
    assertPackedKovoResolutions(
      [sample, ...supportWitnesses],
      projectDir,
      nodeModulesDir,
      config.compilerOptions,
    );
  }
}

function runTypecheck(configPath, shouldPass) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/tsgo'),
    ['-p', configPath, '--pretty', 'false'],
    { cwd: path.dirname(configPath), encoding: 'utf8' },
  );
  if ((result.status === 0) !== shouldPass) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(
      `${path.basename(configPath)} ${shouldPass ? 'failed' : 'unexpectedly passed'}${
        output ? `:\n${output}` : ''
      }`,
    );
  }
}

export function assertPackedKovoResolutions(samples, projectDir, nodeModulesDir, compilerOptions) {
  const normalizedCompilerOptions =
    typeof compilerOptions.moduleResolution === 'string'
      ? ts.convertCompilerOptionsFromJson(compilerOptions, projectDir).options
      : compilerOptions;
  let count = 0;
  for (const sample of samples) {
    const sourceFile = ts.createSourceFile(
      sample.file,
      readFileSync(sample.file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      sample.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const imported of ts.preProcessFile(sourceFile.text).importedFiles) {
      const specifier = imported.fileName;
      if (!KOVO_PACKAGE.test(specifier) && specifier !== 'create-kovo') continue;
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier;
      const resolved = ts.resolveModuleName(
        specifier,
        sample.file,
        normalizedCompilerOptions,
        ts.sys,
      ).resolvedModule;
      if (!resolved) {
        throw sampleError(
          sample.sourcePath,
          sample.startLine,
          `unresolved packed import ${specifier}`,
        );
      }
      const packageDir = canonicalPath(path.join(nodeModulesDir, ...packageName.split('/')));
      const resolvedFile = canonicalPath(resolved.resolvedFileName);
      const relative = path.relative(packageDir, resolvedFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw sampleError(
          sample.sourcePath,
          sample.startLine,
          `${specifier} resolved outside its packed package: ${resolvedFile}`,
        );
      }
      if (resolvedFile.includes(`${path.sep}packages${path.sep}`)) {
        throw sampleError(
          sample.sourcePath,
          sample.startLine,
          `${specifier} fell back to workspace source resolution`,
        );
      }
      count += 1;
    }
  }
  if (count === 0) {
    throw new TypeError(`${path.relative(repoRoot, projectDir)}: no packed Kovo imports resolved`);
  }
  return count;
}

function canonicalPath(candidate) {
  let existing = path.resolve(candidate);
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(candidate);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

function parseArgs(argv) {
  let manifestPath = DEFAULT_PACKED_MANIFEST;
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--keep') keep = true;
    else if (arg === '--packed-manifest') {
      const value = argv[index + 1];
      if (!value) throw new TypeError('--packed-manifest requires a path');
      manifestPath = path.resolve(value);
      index += 1;
    } else {
      throw new TypeError(`unknown packed-doc-samples option ${arg}`);
    }
  }
  return { keep, manifestPath };
}

export async function runPackedDocSamples({
  keep = false,
  manifestPath = DEFAULT_PACKED_MANIFEST,
} = {}) {
  if (!existsSync(manifestPath)) {
    throw new TypeError(
      `${path.relative(repoRoot, manifestPath)} missing; run \`node scripts/pack-public-packages.mjs\` first`,
    );
  }
  const scratch = await mkdtemp(path.join(tmpdir(), 'kovo-packed-doc-samples-'));
  let success = false;
  try {
    const policy = loadCodeSamplePolicy();
    const nodeModulesDir = path.join(scratch, 'node_modules');
    const { manifest, packageDirs } = await materializePackedPackages({
      manifestPath,
      nodeModulesDir,
    });
    await linkExternalDependencies(nodeModulesDir, new Set(packageDirs.keys()));

    const [readmeSamples, guideSamples, generatedApi] = await Promise.all([
      Promise.resolve(workspaceReadmeSamples(packageDirs, policy)),
      authoredGuideSamples(policy),
      generatedApiSamples(policy, path.join(scratch, 'generated-api')),
    ]);
    const apiSamples = generatedApi.samples;
    const samples = [...readmeSamples, ...guideSamples, ...apiSamples];
    assertUniqueSamples(samples);
    validateAuxiliarySamples(samples, policy);
    const cliInvocations = await validateKovoInvocations(samples);

    const authoredProject = path.join(scratch, 'authored');
    const apiProject = path.join(scratch, 'api');
    const authoredWritten = await writeTypescriptSamples(
      authoredProject,
      [...readmeSamples, ...guideSamples],
      { authoredSupport: true, generatedPackages: generatedApi.generated.packages },
    );
    const apiWritten = await writeTypescriptSamples(apiProject, apiSamples, {
      authoredSupport: false,
    });
    apiWritten.push(...(await writePackedApiBindings(apiProject, generatedApi.generated.packages)));
    await compileTypescriptProject(authoredProject, authoredWritten, nodeModulesDir);
    await compileTypescriptProject(apiProject, apiWritten, nodeModulesDir);

    const byClass = Object.fromEntries(
      [...SAMPLE_CLASSES].map((classification) => [
        classification,
        samples.filter((sample) => sample.class === classification).length,
      ]),
    );
    const report = {
      classes: byClass,
      cliInvocations,
      jsdocExamples: apiSamples.filter((sample) => sample.origin === 'generated-api/jsdoc').length,
      origins: {
        authoredGuides: guideSamples.length,
        generatedApi: apiSamples.length,
        packageReadmes: readmeSamples.length,
      },
      packedManifestSha256: `sha256:${sha256(await readFile(manifestPath))}`,
      packages: manifest.packages.length,
      schema: 'kovo.packed-doc-samples/v1',
      samples: samples.length,
    };
    await writeFile(path.join(scratch, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `packed-doc-samples/v1 packages=${report.packages} samples=${report.samples} executable=${byClass.executable} type-error=${byClass['type-error']} output=${byClass.output} illustrative=${byClass.illustrative} jsdoc=${report.jsdocExamples} cli=${cliInvocations} OK\n`,
    );
    success = true;
    return report;
  } finally {
    if (success && !keep) await rm(scratch, { force: true, recursive: true });
    else process.stderr.write(`packed-doc-samples: scratch retained at ${scratch}\n`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

if (isMainEntry(import.meta.url)) {
  await runGate(() => runPackedDocSamples(parseArgs(process.argv.slice(2))));
}
