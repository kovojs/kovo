#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { parseDiagnosticSpecRegistry } from './generate-diagnostic-registry.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const rawDiagnosticChannelInventoryPath = 'security/raw-diagnostic-channel-inventory.json';
export const rawDiagnosticChannelSchema = 'kovo-raw-diagnostic-channel-inventory/v1';

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const excludedPathPattern =
  /(?:^|\/)(?:dist|node_modules|fixtures?|__fixtures__)(?:\/|$)|\.(?:test|spec|bench)\.[^.]+$/u;
const diagnosticCodePattern = /\bKV\d{3}(?:_[A-Z0-9_]+)?\b/gu;
const generatedThrowPattern =
  /\bthrow\s+new\s+[A-Za-z_$][\w$]*Error\s*\([^;]*?\bKV\d{3}[^;]*?\);/gu;

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, ' ').trim();
}

function baseDiagnosticCodes(text) {
  const codes = new Set();
  for (const match of text.matchAll(diagnosticCodePattern)) {
    codes.add(match[0].slice(0, 5));
  }
  return [...codes].sort(asciiCompare);
}

function callName(node, sourceFile) {
  return node.expression.getText(sourceFile).replace(/\s+/gu, '');
}

function directChannelKind(node, sourceFile) {
  if (ts.isThrowStatement(node)) return 'throw';
  if (ts.isNewExpression(node)) {
    const constructor = node.expression.getText(sourceFile);
    return /(?:Error|Exception)$/u.test(constructor) ? 'error-object' : undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  const callee = callName(node, sourceFile);
  if (callee === 'Promise.reject' || callee === 'reject' || callee.endsWith('.reject')) {
    return 'rejection';
  }
  if (/^(?:globalThis\.)?console\.(?:error|warn|log)$/u.test(callee)) return 'log';
  return undefined;
}

function hasChannelAncestor(node, sourceFile) {
  let owner = node.parent;
  while (owner) {
    if (directChannelKind(owner, sourceFile)) return true;
    if (ts.isFunctionLike(owner) || ts.isSourceFile(owner)) return false;
    owner = owner.parent;
  }
  return false;
}

function enclosingOwner(node, sourceFile) {
  let owner = node.parent;
  while (owner) {
    if (
      ts.isFunctionDeclaration(owner) ||
      ts.isMethodDeclaration(owner) ||
      ts.isFunctionExpression(owner) ||
      ts.isArrowFunction(owner)
    ) {
      if ('name' in owner && owner.name) return owner.name.getText(sourceFile);
      const parent = owner.parent;
      if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
        return parent.name.getText(sourceFile);
      }
      return '<anonymous>';
    }
    owner = owner.parent;
  }
  return '<module>';
}

function inferredLayer(file, channel) {
  if (channel === 'generated-runtime') return 'generated-runtime';
  if (file.startsWith('packages/test/')) return 'verifier';
  if (
    file.startsWith('packages/compiler/') ||
    file.startsWith('packages/cli/') ||
    file.startsWith('packages/create-kovo/') ||
    file.startsWith('packages/drizzle/src/static') ||
    file === 'packages/drizzle/src/graph.ts' ||
    file === 'packages/drizzle/src/trust-escapes-static.ts' ||
    /^packages\/server\/src\/(?:build|neutral-build|static-export|vite-build-assets|vite-manifest)/u.test(
      file,
    )
  ) {
    return 'analysis';
  }
  return 'runtime';
}

function rawSite({ channel, code, file, node, owner, sourceFile }) {
  const expression = normalizedNodeText(node, sourceFile);
  const expressionSha256 = sha256(expression);
  return {
    channel,
    code,
    expressionSha256,
    file,
    layer: inferredLayer(file, channel),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    owner,
  };
}

function rawGeneratedSite({ code, expression, file, line, owner }) {
  return {
    channel: 'generated-runtime',
    code,
    expressionSha256: sha256(expression.replace(/\s+/gu, ' ').trim()),
    file,
    layer: 'generated-runtime',
    line,
    owner,
  };
}

/** Syntax-derived inventory for one production source file. */
export function collectRawDiagnosticChannelsFromSource(file, source) {
  const scriptKind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const sites = [];

  function visit(node) {
    const channel = directChannelKind(node, sourceFile);
    if (channel && !hasChannelAncestor(node, sourceFile)) {
      const codes = baseDiagnosticCodes(node.getText(sourceFile));
      for (const code of codes) {
        sites.push(
          rawSite({
            channel,
            code,
            file,
            node,
            owner: enclosingOwner(node, sourceFile),
            sourceFile,
          }),
        );
      }
    }

    // Compiler emitters carry executable runtime guards as source literals. Bind those strings as
    // generated-runtime channels instead of pretending the outer compiler throw owns the sink.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const match of node.text.matchAll(generatedThrowPattern)) {
        const expression = match[0];
        const prefix = node.text.slice(0, match.index);
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
          1 +
          (prefix.match(/\n/gu)?.length ?? 0);
        for (const code of baseDiagnosticCodes(expression)) {
          sites.push(
            rawGeneratedSite({
              code,
              expression,
              file,
              line,
              owner: enclosingOwner(node, sourceFile),
            }),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const duplicateCounts = new Map();
  return sites
    .sort((left, right) => left.line - right.line || asciiCompare(left.code, right.code))
    .map((site) => {
      const base = `${site.file}#${site.channel}#${site.code}#${site.expressionSha256}`;
      const ordinal = duplicateCounts.get(base) ?? 0;
      duplicateCounts.set(base, ordinal + 1);
      return { ...site, id: `${base}#${ordinal}` };
    });
}

function productionSourceFiles(root) {
  const files = [];
  const packagesRoot = path.join(root, 'packages');
  for (const packageDirent of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!packageDirent.isDirectory()) continue;
    const packageRoot = path.join(packagesRoot, packageDirent.name);
    const manifestPath = path.join(packageRoot, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private === true) continue;
    const sourceRoot = path.join(packageRoot, 'src');
    collectSourceFiles(root, sourceRoot, files);
  }
  return files.sort(asciiCompare);
}

function collectSourceFiles(root, directory, output) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(root, absolute, output);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue;
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    if (!excludedPathPattern.test(relative)) output.push(relative);
  }
}

export function collectRawDiagnosticChannels({ root = repoRoot } = {}) {
  const sites = [];
  for (const file of productionSourceFiles(root)) {
    sites.push(
      ...collectRawDiagnosticChannelsFromSource(file, readFileSync(path.join(root, file), 'utf8')),
    );
  }
  return sites.sort((left, right) => asciiCompare(left.id, right.id));
}

export function renderRawDiagnosticChannelInventory({ diagnosticRows, sites }) {
  const registry = new Map(diagnosticRows.map((row) => [row.code, row]));
  return {
    $comment:
      'Syntax-derived closed inventory of production raw KV Error/throw/rejection/log channels. Regenerate only after reviewing code, layer, and registry-posture changes.',
    schema: rawDiagnosticChannelSchema,
    channels: sites.map(({ id, channel, code, expressionSha256, file, layer, owner }) => ({
      id,
      code,
      enforcementClass: registry.get(code)?.enforcementClass ?? 'UNREGISTERED',
      severity: registry.get(code)?.severity ?? 'UNREGISTERED',
      layer,
      channel,
      file,
      owner,
      expressionSha256,
    })),
  };
}

export function validateRawDiagnosticChannelInventory({ artifact, diagnosticRows, sites }) {
  const findings = [];
  if (artifact?.schema !== rawDiagnosticChannelSchema) {
    findings.push(`schema must be ${rawDiagnosticChannelSchema}`);
  }
  const registry = new Map(diagnosticRows.map((row) => [row.code, row]));
  const actualById = new Map(sites.map((site) => [site.id, site]));
  const rows = Array.isArray(artifact?.channels) ? artifact.channels : [];
  if (!Array.isArray(artifact?.channels)) findings.push('channels must be an array');
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      findings.push(`channels[${index}] must be an object`);
      continue;
    }
    if (typeof row.id !== 'string') {
      findings.push(`channels[${index}].id must be a string`);
      continue;
    }
    if (seen.has(row.id)) findings.push(`duplicate channel ${row.id}`);
    seen.add(row.id);
    const actual = actualById.get(row.id);
    if (!actual) {
      findings.push(`inventoried channel is absent or changed: ${row.id}`);
      continue;
    }
    const diagnostic = registry.get(actual.code);
    if (!diagnostic) {
      findings.push(`${actual.id} names unregistered diagnostic ${actual.code}`);
      continue;
    }
    for (const field of ['channel', 'code', 'expressionSha256', 'file', 'layer', 'owner']) {
      if (row[field] !== actual[field]) findings.push(`${row.id} has stale ${field}`);
    }
    if (
      row.enforcementClass !== diagnostic.enforcementClass ||
      row.severity !== diagnostic.severity
    ) {
      findings.push(
        `${row.id} posture must be ${diagnostic.severity}/${diagnostic.enforcementClass}`,
      );
    }
  }
  for (const site of sites) {
    if (!seen.has(site.id)) findings.push(`unclassified raw diagnostic channel: ${site.id}`);
  }
  return { findings, ok: findings.length === 0 };
}

function diagnosticRows(root) {
  return parseDiagnosticSpecRegistry(
    readFileSync(path.join(root, 'spec/11-diagnostics.md'), 'utf8'),
  );
}

export function expectedRawDiagnosticChannelInventory({ root = repoRoot } = {}) {
  return renderRawDiagnosticChannelInventory({
    diagnosticRows: diagnosticRows(root),
    sites: collectRawDiagnosticChannels({ root }),
  });
}

export function checkRawDiagnosticChannelInventory({ root = repoRoot } = {}) {
  const artifact = JSON.parse(
    readFileSync(path.join(root, rawDiagnosticChannelInventoryPath), 'utf8'),
  );
  return validateRawDiagnosticChannelInventory({
    artifact,
    diagnosticRows: diagnosticRows(root),
    sites: collectRawDiagnosticChannels({ root }),
  });
}

export function runRawDiagnosticChannelGate(args = process.argv.slice(2)) {
  if (args.includes('--write')) {
    writeFileSync(
      path.join(repoRoot, rawDiagnosticChannelInventoryPath),
      `${JSON.stringify(expectedRawDiagnosticChannelInventory(), null, 2)}\n`,
      'utf8',
    );
    process.stdout.write('raw-diagnostic-channel-inventory/v1 wrote=1\nOK\n');
    return 0;
  }
  const result = checkRawDiagnosticChannelInventory();
  const count = expectedRawDiagnosticChannelInventory().channels.length;
  process.stdout.write(`raw-diagnostic-channel-inventory/v1 channels=${count}\n`);
  if (result.ok) {
    process.stdout.write('OK\n');
    return 0;
  }
  process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  return 1;
}

if (isMainEntry(import.meta.url)) await runGate(runRawDiagnosticChannelGate);
