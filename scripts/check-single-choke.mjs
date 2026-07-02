#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export const defaultSourceRoots = ['packages/server/src'];
export const defaultAllowedExternalEgressFiles = [
  'packages/server/src/app-load-shed.ts',
  'packages/server/src/app-system-response.ts',
  'packages/server/src/build.ts',
  'packages/server/src/capability-route.ts',
  'packages/server/src/deferred-stream.ts',
  'packages/server/src/file.ts',
  'packages/server/src/mutation/streaming.ts',
  'packages/server/src/node.ts',
  'packages/server/src/response-posture.ts',
  'packages/server/src/vite-dev.ts',
];
export const defaultAllowedDriverFiles = [
  'packages/server/src/sql-safe-handle.ts',
  'packages/server/src/sql-write-oracle.ts',
  'packages/server/src/mutation.ts',
  'packages/server/src/task-observability.ts',
  'packages/server/src/task-queue.ts',
  'packages/server/src/task-cron.ts',
];
export const defaultAllowedRawTargetFiles = [
  'packages/server/src/sql-safe-handle.ts',
  'packages/server/src/managed-db.ts',
  'packages/server/src/task-queue.ts',
  'packages/server/src/mutation.ts',
];

const driverMethodNames = new Set([
  '$client',
  'all',
  'batch',
  'exec',
  'execute',
  'get',
  'prepare',
  'query',
  'run',
  'session',
  'transaction',
  'values',
  'with',
]);
const sqlReceiverPattern =
  /(?:^|\.)(?:db|database|client|handle|session|tx|transaction|executor|sql|driver)$/iu;
const managedHandleFactories = new Set(['managedDb', 'readonlyDb', 'wrapManagedDbForSqlSafety']);
const externalEgressSinkPatterns = [
  {
    label: 'Response constructor',
    pattern: /\bnew\s+Response\s*\(/gu,
  },
  {
    label: 'Response.json',
    pattern: /\bResponse\.json\s*\(/gu,
  },
  {
    label: 'Headers constructor',
    pattern: /\bnew\s+Headers\s*\(/gu,
  },
  {
    label: 'response header mutation',
    pattern: /\.headers\.(?:append|delete|set)\s*\(/gu,
  },
  {
    label: 'ReadableStream constructor',
    pattern: /\bnew\s+ReadableStream\s*\(/gu,
  },
  {
    label: 'TransformStream constructor',
    pattern: /\bnew\s+TransformStream\s*\(/gu,
  },
  {
    label: 'route binary/stream response outcome',
    pattern: /\brespond\.(?:file|json|storedFile|stream)\s*\(/gu,
  },
];

export function checkSingleChoke(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sourceRoots = options.sourceRoots ?? defaultSourceRoots;
  const sourceFiles =
    options.sourceFiles ?? collectSourceFiles(root, sourceRoots, { productionRoots: sourceRoots });
  const allowedDriverFiles = new Set(options.allowedDriverFiles ?? defaultAllowedDriverFiles);
  const allowedExternalEgressFiles = new Set(
    options.allowedExternalEgressFiles ?? defaultAllowedExternalEgressFiles,
  );
  const allowedRawTargetFiles = new Set(
    options.allowedRawTargetFiles ?? defaultAllowedRawTargetFiles,
  );
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));

  const findings = [];
  const chokePath = 'packages/server/src/sql-safe-handle.ts';
  if (!exists(chokePath)) {
    findings.push(`${chokePath}: managed SQL choke file is missing`);
  } else {
    const chokeText = readText(chokePath);
    const declarations = [...enforceManagedSqlDeclarationIndexes(chokeText)];
    if (declarations.length !== 1) {
      findings.push(
        `${chokePath}: expected exactly one enforceManagedSql() declaration, found ${declarations.length}`,
      );
    }
  }

  for (const filePath of sourceFiles) {
    const sourceText = readText(filePath);
    const scanText = stripCommentsAndStrings(sourceText);
    const allowedDriverFile = allowedDriverFiles.has(filePath);
    const allowedExternalEgressFile = allowedExternalEgressFiles.has(filePath);
    const allowedRawTargetFile = allowedRawTargetFiles.has(filePath);

    for (const match of sqlDriverPropertyUses(scanText)) {
      if (!allowedDriverFile) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: driver method/property .${match.name} must route through enforceManagedSql() in sql-safe-handle.ts or an audited durable-task internal SQL executor`,
        );
      }
    }

    for (const match of externalEgressSinkUses(scanText)) {
      if (!allowedExternalEgressFile) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: ${match.label} is an external egress sink and must be classified in the DEC-J sole-door inventory or route through emitToWire()`,
        );
      }
    }

    for (const index of callIndexes(scanText, 'frameworkManagedDbRawTarget')) {
      if (!allowedRawTargetFile) {
        findings.push(
          `${filePath}:${lineOf(sourceText, index)}: frameworkManagedDbRawTarget() is an internal bypass and must stay in audited framework files`,
        );
      }
    }

    for (const match of managedHandleFactoryCalls(scanText)) {
      if (!isAllowedManagedHandleFactoryFile(filePath)) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: managed DB handle factories must stay in framework-owned composition points`,
        );
      }
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK DEC-J egress/DB exec sinks route through classified sole-door chokes'
        : `${findings.length} DEC-J sole-door violation(s)`,
  };
}

export function main(options = {}) {
  const result = checkSingleChoke(options);
  process.stdout.write(`check-single-choke/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function isAllowedManagedHandleFactoryFile(filePath) {
  return (
    filePath === 'packages/server/src/managed-db.ts' ||
    filePath === 'packages/server/src/guards.ts' ||
    filePath === 'packages/server/src/webhook.ts'
  );
}

function* enforceManagedSqlDeclarationIndexes(sourceText) {
  const patterns = [
    /\bfunction\s+enforceManagedSql\s*\(/gu,
    /\b(?:export\s+)?const\s+enforceManagedSql\s*=\s*securityClassifier\s*\(/gu,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) yield match.index ?? 0;
  }
}

function* sqlDriverPropertyUses(sourceText) {
  const methodAlternation = [...driverMethodNames].map(escapeRegExp).join('|');
  const regex = new RegExp(
    `(?<receiver>(?:this|[A-Za-z_$][\\w$]*)(?:\\.[A-Za-z_$][\\w$]*)*)\\.(?<name>${methodAlternation})\\b`,
    'gu',
  );
  for (const match of sourceText.matchAll(regex)) {
    const receiver = match.groups?.receiver ?? '';
    const name = match.groups?.name ?? '';
    if (!driverMethodNames.has(name)) continue;
    if (!looksLikeSqlReceiver(receiver)) continue;
    yield { index: match.index ?? 0, name };
  }
}

function* externalEgressSinkUses(sourceText) {
  for (const sink of externalEgressSinkPatterns) {
    for (const match of sourceText.matchAll(sink.pattern)) {
      yield { index: match.index ?? 0, label: sink.label };
    }
  }
}

function looksLikeSqlReceiver(receiver) {
  if (receiver === 'this') return true;
  if (sqlReceiverPattern.test(receiver)) return true;
  if (receiver.endsWith('.executor')) return true;
  if (receiver.endsWith('.session.client')) return true;
  return false;
}

function* callIndexes(sourceText, name) {
  const regex = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, 'gu');
  for (const match of sourceText.matchAll(regex)) yield match.index ?? 0;
}

function* managedHandleFactoryCalls(sourceText) {
  for (const name of managedHandleFactories) {
    for (const index of callIndexes(sourceText, name)) yield { index, name };
  }
}

function stripCommentsAndStrings(sourceText) {
  let result = '';
  let index = 0;
  while (index < sourceText.length) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (char === '/' && next === '/') {
      const end = sourceText.indexOf('\n', index + 2);
      const stop = end === -1 ? sourceText.length : end;
      result += spacesPreservingNewlines(sourceText.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sourceText.indexOf('*/', index + 2);
      const stop = end === -1 ? sourceText.length : end + 2;
      result += spacesPreservingNewlines(sourceText.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const { text, nextIndex } = stripQuotedString(sourceText, index, char);
      result += text;
      index = nextIndex;
      continue;
    }
    if (char === '`') {
      const { text, nextIndex } = stripTemplateString(sourceText, index);
      result += text;
      index = nextIndex;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function stripQuotedString(sourceText, start, quote) {
  let index = start + 1;
  while (index < sourceText.length) {
    if (sourceText[index] === '\\') {
      index += 2;
      continue;
    }
    if (sourceText[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }
  return { nextIndex: index, text: spacesPreservingNewlines(sourceText.slice(start, index)) };
}

function stripTemplateString(sourceText, start) {
  let index = start + 1;
  while (index < sourceText.length) {
    if (sourceText[index] === '\\') {
      index += 2;
      continue;
    }
    if (sourceText[index] === '`') {
      index += 1;
      break;
    }
    index += 1;
  }
  return { nextIndex: index, text: spacesPreservingNewlines(sourceText.slice(start, index)) };
}

function spacesPreservingNewlines(value) {
  return value.replace(/[^\n]/gu, ' ');
}

function lineOf(sourceText, index) {
  return sourceText.slice(0, index).split('\n').length;
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

if (isMainEntry(import.meta.url)) await runGate(main);
