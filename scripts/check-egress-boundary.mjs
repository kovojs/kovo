#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export const defaultSourceRoots = ['packages/server/src'];
export const egressBoundaryFiles = [
  'packages/server/src/egress.ts',
  'packages/server/src/egress-dgram.ts',
  'packages/server/src/egress-undici.ts',
  'packages/server/src/egress-undici-runtime.ts',
  'packages/server/src/egress-bootstrap.ts',
  'packages/server/src/egress-credentials.ts',
];
export const defaultAllowedFrameworkFiles = [
  ...egressBoundaryFiles,
  'packages/server/src/build.ts',
  'packages/server/src/vite-dev.ts',
];

const outboundCallPatterns = [
  { label: 'fetch', pattern: /(?<![\w$.])fetch\s*\(/gu },
  { label: 'globalThis.fetch', pattern: /\bglobalThis\.fetch\s*(?:\(|\.bind\s*\()/gu },
  { label: 'http.request', pattern: /\bhttps?\.request\s*\(/gu },
  { label: 'http.get', pattern: /\bhttps?\.get\s*\(/gu },
  { label: 'net.connect', pattern: /\bnet\.(?:connect|createConnection)\s*\(/gu },
  { label: 'new net.Socket', pattern: /\bnew\s+net\.Socket\s*\(/gu },
  { label: 'dgram.createSocket', pattern: /\bdgram\.createSocket\s*\(/gu },
  { label: 'undici.request', pattern: /\bundici\.(?:request|fetch|connect)\s*\(/gu },
];

export function checkEgressBoundary(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sourceRoots = options.sourceRoots ?? defaultSourceRoots;
  const sourceFiles =
    options.sourceFiles ?? collectSourceFiles(root, sourceRoots, { productionRoots: sourceRoots });
  const allowedFiles = new Set(options.allowedFiles ?? defaultAllowedFrameworkFiles);
  const boundary = new Set(options.boundaryFiles ?? egressBoundaryFiles);
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));

  const findings = [];
  for (const filePath of boundary) {
    if (!exists(filePath)) findings.push(`${filePath}: egress boundary file is missing`);
  }
  if (exists('packages/server/src/egress.ts')) {
    const text = readText('packages/server/src/egress.ts');
    const declarations = [...text.matchAll(/\bframeworkEgressFetch\b/gu)];
    if (declarations.length < 1) {
      findings.push('packages/server/src/egress.ts: frameworkEgressFetch choke is missing');
    }
    const fetchStart = text.indexOf('export const frameworkEgressFetch');
    const originCheck = text.indexOf('evaluateFrameworkDestinationOrigin({', fetchStart);
    const dnsLookup = text.indexOf('lookupAllAddresses(host)', fetchStart);
    const dispatcherPin = text.indexOf(
      'egressRequestWithDispatcher(request, dispatcher)',
      fetchStart,
    );
    if (fetchStart < 0 || originCheck < fetchStart || dnsLookup < originCheck) {
      findings.push(
        'packages/server/src/egress.ts: framework origin allowlist must reject before DNS',
      );
    }
    if (dispatcherPin < fetchStart || dispatcherPin > originCheck) {
      findings.push(
        'packages/server/src/egress.ts: framework Request must pin the installed dispatcher before egress',
      );
    }
  }
  if (exists('packages/server/src/egress-undici.ts')) {
    const text = readText('packages/server/src/egress-undici.ts');
    const dispatchStart = text.indexOf('override dispatch(');
    const originCheck = text.indexOf('evaluateFrameworkDestinationOrigin({', dispatchStart);
    const dnsLookup = text.indexOf('dnsLookup(host, { all: true })', dispatchStart);
    if (dispatchStart < 0 || originCheck < dispatchStart || dnsLookup < originCheck) {
      findings.push(
        'packages/server/src/egress-undici.ts: redirect/pooled origin allowlist must reject before DNS',
      );
    }
  }
  if (exists('packages/server/src/task-runner.ts')) {
    const text = readText('packages/server/src/task-runner.ts');
    if (!text.includes('fetch: frameworkEgressFetch') || text.includes('hooks.fetch')) {
      findings.push(
        'packages/server/src/task-runner.ts: task ctx.fetch must be the non-replaceable framework capability',
      );
    }
  }
  if (exists('packages/server/src/webhook.ts')) {
    const text = readText('packages/server/src/webhook.ts');
    if (!text.includes('fetch: frameworkEgressFetch')) {
      findings.push(
        'packages/server/src/webhook.ts: webhook ctx.fetch must be the framework capability',
      );
    }
  }

  for (const filePath of sourceFiles) {
    const sourceText = readText(filePath);
    const scanText = stripCommentsAndStrings(sourceText);
    const allowed = allowedFiles.has(filePath);
    for (const match of outboundPrimitiveUses(scanText)) {
      if (!allowed) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: outbound ${match.label} must route through frameworkEgressFetch() / the DEC6 egress boundary`,
        );
      }
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK outbound network primitives route through the DEC6 egress boundary'
        : `${findings.length} egress boundary violation(s)`,
  };
}

export function main(options = {}) {
  const result = checkEgressBoundary(options);
  process.stdout.write(`check-egress-boundary/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function* outboundPrimitiveUses(sourceText) {
  for (const { label, pattern } of outboundCallPatterns) {
    pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(pattern)) yield { index: match.index ?? 0, label };
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
  let result = '`';
  let index = start + 1;
  while (index < sourceText.length) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (char === '\\') {
      result += '  ';
      index += 2;
      continue;
    }
    if (char === '`') {
      result += '`';
      index += 1;
      break;
    }
    if (char === '$' && next === '{') {
      const expression = readTemplateExpression(sourceText, index + 2);
      result += '${' + stripCommentsAndStrings(expression.text) + '}';
      index = expression.nextIndex;
      continue;
    }
    result += char === '\n' ? '\n' : ' ';
    index += 1;
  }
  return { nextIndex: index, text: result };
}

function readTemplateExpression(sourceText, start) {
  let depth = 1;
  let index = start;
  while (index < sourceText.length && depth > 0) {
    const char = sourceText[index];
    if (char === '"' || char === "'") {
      index = stripQuotedString(sourceText, index, char).nextIndex;
      continue;
    }
    if (char === '`') {
      index = stripTemplateString(sourceText, index).nextIndex;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  return { nextIndex: index, text: sourceText.slice(start, Math.max(start, index - 1)) };
}

function spacesPreservingNewlines(value) {
  return value.replace(/[^\n]/gu, ' ');
}

function lineOf(sourceText, index) {
  return sourceText.slice(0, index).split('\n').length;
}

if (isMainEntry(import.meta.url)) await runGate(main);
