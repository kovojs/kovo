#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export const defaultSourceRoots = ['packages/server/src'];
export const wireChokeFile = 'packages/server/src/response-posture.ts';
export const finiteMcpStdioOutputFile = 'packages/core/src/internal/mcp-stdio.ts';
export const wireBodyProvenanceFile = 'packages/compiler/src/scan/security-operation-ir.ts';
export const wireBodyProvenanceRelationFile =
  'packages/compiler/src/scan/security-provenance-relation.ts';
export const wireBodyProvenanceOracleFile =
  'packages/compiler/src/security-operation-ir.response-body-provenance.security.test.ts';
export const defaultAllowedResponseConstructorFiles = [
  wireChokeFile,
  // Dev/build adapters are edge shims around the app handler or generated host assets.
  'packages/server/src/build.ts',
  'packages/server/src/vite-dev.ts',
];
export const defaultAllowedNodeHeaderWriteFiles = [
  'packages/server/src/build.ts',
  'packages/server/src/node.ts',
  'packages/server/src/vite-dev.ts',
];

const responseConstructorPatterns = [
  { label: 'new Response', pattern: /\bnew\s+Response\s*\(/gu },
  { label: 'Response.json', pattern: /\bResponse\.json\s*\(/gu },
];
const nodeHeaderWritePatterns = [
  { label: 'writeHead', pattern: /\.(?:writeHead)\s*\(/gu },
  { label: 'setHeader', pattern: /\.(?:setHeader)\s*\(/gu },
];

export function checkWireOutputBoundary(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sourceRoots = options.sourceRoots ?? defaultSourceRoots;
  const sourceFiles =
    options.sourceFiles ?? collectSourceFiles(root, sourceRoots, { productionRoots: sourceRoots });
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const allowedResponseConstructorFiles = new Set(
    options.allowedResponseConstructorFiles ?? defaultAllowedResponseConstructorFiles,
  );
  const allowedNodeHeaderWriteFiles = new Set(
    options.allowedNodeHeaderWriteFiles ?? defaultAllowedNodeHeaderWriteFiles,
  );

  const findings = [];
  if (!exists(wireChokeFile)) {
    findings.push(`${wireChokeFile}: DEC5 emitToWire() choke file is missing`);
  } else {
    const text = readText(wireChokeFile);
    if (!hasExportedEmitToWireChoke(stripCommentsAndStrings(text))) {
      findings.push(`${wireChokeFile}: exported emitToWire() choke is missing`);
    }
  }
  checkWireBodyProvenanceClosure({ exists, findings, readText });
  checkFiniteMcpStdioOutputClosure({ exists, findings, readText });

  for (const filePath of sourceFiles) {
    const sourceText = readText(filePath);
    const scanText = stripCommentsAndStrings(sourceText);
    const responseAllowed = allowedResponseConstructorFiles.has(filePath);
    const nodeHeaderAllowed = allowedNodeHeaderWriteFiles.has(filePath);

    for (const match of patternUses(scanText, responseConstructorPatterns)) {
      if (!responseAllowed) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: ${match.label} must route through emitToWire() / the DEC5 wire-output choke`,
        );
      }
    }

    for (const match of patternUses(scanText, nodeHeaderWritePatterns)) {
      if (!nodeHeaderAllowed) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: ${match.label} must stay behind the adapter/header bridge, not a framework response path`,
        );
      }
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK HTTP responses route through DEC5, Layer-3 body provenance closes, and finite MCP stdout is bounded'
        : `${findings.length} wire-output boundary violation(s)`,
  };
}

function checkFiniteMcpStdioOutputClosure({ exists, findings, readText }) {
  if (!exists(finiteMcpStdioOutputFile)) {
    findings.push(`${finiteMcpStdioOutputFile}: finite MCP stdio output choke is missing`);
    return;
  }

  const sourceText = readText(finiteMcpStdioOutputFile);
  const scanText = stripCommentsAndStrings(sourceText);
  const serializerUses = countMatches(scanText, /\bserializeFiniteMcpJsonLine\s*\(/gu);
  if (serializerUses !== 2) {
    findings.push(
      `${finiteMcpStdioOutputFile}: serializeFiniteMcpJsonLine must have one declaration and one output call; found ${serializerUses}`,
    );
  }
  if (
    !/\bwriteWithBackpressure\s*\(\s*output\s*,\s*serializeFiniteMcpJsonLine\s*\(\s*response\s*,\s*maxLineBytes\s*\)\s*\)/u.test(
      scanText,
    )
  ) {
    findings.push(
      `${finiteMcpStdioOutputFile}: MCP responses must route through serializeFiniteMcpJsonLine before backpressured stdout`,
    );
  }
  const rawOutputWrites = countMatches(scanText, /\boutput\.write\s*\(/gu);
  if (rawOutputWrites !== 1) {
    findings.push(
      `${finiteMcpStdioOutputFile}: the finite MCP transport must have exactly one raw output.write sink; found ${rawOutputWrites}`,
    );
  }
  for (const anchor of [
    "Buffer.byteLength(encoded, 'utf8') > maxLineBytes",
    'jsonRpcError(responseId, -32603, `response exceeds ${maxLineBytes} bytes`)',
    "throw new TypeError('bounded MCP error response exceeds maxLineBytes')",
    'return `${encoded}\\n`',
  ]) {
    if (!sourceText.includes(anchor)) {
      findings.push(
        `${finiteMcpStdioOutputFile}: bounded MCP output anchor is missing: ${JSON.stringify(anchor)}`,
      );
    }
  }
}

function checkWireBodyProvenanceClosure({ exists, findings, readText }) {
  const required = [
    wireBodyProvenanceFile,
    wireBodyProvenanceRelationFile,
    wireBodyProvenanceOracleFile,
  ];
  for (const filePath of required) {
    if (!exists(filePath))
      findings.push(`${filePath}: response-body provenance artifact is missing`);
  }
  if (required.some((filePath) => !exists(filePath))) return;

  const scanner = readText(wireBodyProvenanceFile);
  const relation = readText(wireBodyProvenanceRelationFile);
  const oracle = readText(wireBodyProvenanceOracleFile);
  const scannerAnchors = [
    "setServerAliasPattern(node.variableDeclaration.name, 'unsafe-wire-data', aliases)",
    "setServerAliasPattern(parameterSnapshot[0]!.name, 'unsafe-wire-data', aliases)",
    "appendUnsafeWireBodyViolation(\n            node.arguments?.[0],\n            'new Response'",
    'appendUnsafeWireBodyViolation(call.arguments[0], target, aliases, appendViolation)',
  ];
  for (const anchor of scannerAnchors) {
    if (!scanner.includes(anchor)) {
      findings.push(
        `${wireBodyProvenanceFile}: Layer-3 response-body provenance anchor is missing: ${JSON.stringify(anchor)}`,
      );
    }
  }
  if (!relation.includes("'unsafe-wire-data': { default: 'unsafe-wire-data' }")) {
    findings.push(
      `${wireBodyProvenanceRelationFile}: unsafe-wire-data is missing from the closed member relation`,
    );
  }
  for (const anchor of [
    '@kovo-security-classifier-corpus finite-security-operation-ir',
    'a catch-bound Error.message',
    'the raw request URL',
    'a request-derived JSON field',
  ]) {
    if (!oracle.includes(anchor)) {
      findings.push(
        `${wireBodyProvenanceOracleFile}: hostile response-body oracle anchor is missing: ${JSON.stringify(anchor)}`,
      );
    }
  }
}

function hasExportedEmitToWireChoke(scanText) {
  return (
    /\bexport\s+function\s+emitToWire\s*\(/u.test(scanText) ||
    /\bexport\s+const\s+emitToWire\s*=\s*wireEmitter\s*\(/u.test(scanText)
  );
}

export function main() {
  const result = checkWireOutputBoundary();
  process.stdout.write(`check-wire-output-boundary/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function* patternUses(sourceText, patterns) {
  for (const { label, pattern } of patterns) {
    pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(pattern)) yield { index: match.index ?? 0, label };
  }
}

function countMatches(sourceText, pattern) {
  pattern.lastIndex = 0;
  return [...sourceText.matchAll(pattern)].length;
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
