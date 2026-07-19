#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const diagnosticSpecPath = 'spec/11-diagnostics.md';
export const generatedDiagnosticRegistryPath =
  'packages/core/src/internal/diagnostic-registry.generated.ts';
export const diagnosticEnforcementClasses = Object.freeze([
  'compile-error',
  'fail-closed-runtime',
  'audited-escape',
]);

const diagnosticSeverities = new Set(['error', 'warn', 'lint', 'notice']);
const enforcementClasses = new Set(diagnosticEnforcementClasses);

export function parseDiagnosticSpecRegistry(markdown, { source = diagnosticSpecPath } = {}) {
  const rows = [];
  const seen = new Set();
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(
      /^\|\s*(KV\d{3})\s*\|\s*(error|warn|lint|notice)\s*\|\s*(compile-error|fail-closed-runtime|audited-escape)\s*\|\s*(.*?)\s*\|$/u,
    );
    if (!match) continue;
    const [, code, severity, enforcementClass, meaning] = match;
    if (seen.has(code)) throw new Error(`${source}: duplicate diagnostic row ${code}`);
    seen.add(code);
    if (!diagnosticSeverities.has(severity)) {
      throw new Error(`${source}: ${code} has unknown severity ${severity}`);
    }
    if (!enforcementClasses.has(enforcementClass)) {
      throw new Error(`${source}: ${code} has unknown enforcement class ${enforcementClass}`);
    }
    if (meaning.trim().length === 0) throw new Error(`${source}: ${code} has no meaning`);
    rows.push({ code, enforcementClass, meaning, severity });
  }
  if (rows.length === 0) {
    throw new Error(
      `${source}: no four-column diagnostic rows found; every KV row needs an enforcement class`,
    );
  }
  rows.sort((left, right) => Number(left.code.slice(2)) - Number(right.code.slice(2)));
  return rows;
}

export function renderGeneratedDiagnosticRegistry(rows) {
  const registryRows = rows
    .map(
      ({ code, enforcementClass }) =>
        `  ${code}: createRegisteredDiagnosticDefinition('${code}', '${enforcementClass}'),`,
    )
    .join('\n');
  const constructorRows = rows
    .map(({ code }) => `  ${code}: createDiagnosticConstructor('${code}'),`)
    .join('\n');

  return `// Generated from spec/11-diagnostics.md by scripts/generate-diagnostic-registry.mjs.
// Do not edit by hand. SPEC §2 and §11 own the source registry and enforcement classes.
import {
  createDiagnosticConstructor,
  createRegisteredDiagnosticDefinition,
  freezeGeneratedDiagnosticMap,
  type DiagnosticConstructorRegistry,
  type RegisteredDiagnosticRegistry,
} from '../diagnostics.js';

/** @internal Normative diagnostics registry paired with SPEC §2 enforcement classes. */
export const diagnosticRegistry = freezeGeneratedDiagnosticMap({
${registryRows}
} satisfies RegisteredDiagnosticRegistry);

/** @internal Typed, registry-derived constructor for every normative KV diagnostic. */
export const diagnosticConstructors = freezeGeneratedDiagnosticMap({
${constructorRows}
} satisfies DiagnosticConstructorRegistry);
`;
}

export function expectedGeneratedDiagnosticRegistry({ root = repoRoot } = {}) {
  const markdown = readFileSync(path.join(root, diagnosticSpecPath), 'utf8');
  return renderGeneratedDiagnosticRegistry(parseDiagnosticSpecRegistry(markdown));
}

export function checkGeneratedDiagnosticRegistry({ root = repoRoot } = {}) {
  const expected = expectedGeneratedDiagnosticRegistry({ root });
  const generatedPath = path.join(root, generatedDiagnosticRegistryPath);
  let actual;
  try {
    actual = readFileSync(generatedPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        findings: [
          `${generatedDiagnosticRegistryPath}: missing; run node scripts/generate-diagnostic-registry.mjs --write`,
        ],
        ok: false,
      };
    }
    throw error;
  }
  const findings =
    actual === expected
      ? []
      : [
          `${generatedDiagnosticRegistryPath}: stale; run node scripts/generate-diagnostic-registry.mjs --write`,
        ];
  return { findings, ok: findings.length === 0 };
}

export function writeGeneratedDiagnosticRegistry({ root = repoRoot } = {}) {
  writeFileSync(
    path.join(root, generatedDiagnosticRegistryPath),
    expectedGeneratedDiagnosticRegistry({ root }),
    'utf8',
  );
}

export function runDiagnosticRegistryGenerator(args = process.argv.slice(2)) {
  if (args.includes('--write')) {
    writeGeneratedDiagnosticRegistry();
    process.stdout.write('diagnostic-registry-generator/v1 wrote=1\nOK\n');
    return 0;
  }
  const result = checkGeneratedDiagnosticRegistry();
  process.stdout.write('diagnostic-registry-generator/v1\n');
  if (result.ok) {
    process.stdout.write('OK\n');
    return 0;
  }
  process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  return 1;
}

if (isMainEntry(import.meta.url)) await runGate(runDiagnosticRegistryGenerator);
