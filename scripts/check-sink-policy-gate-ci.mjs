#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSinkPolicyGate, repoRoot } from './check-sink-policy-gate.mjs';

const drizzleStaticCompilePath = 'packages/cli/src/commands/compile.ts';
const drizzleStaticExitFinding = `${drizzleStaticCompilePath}: drizzle-static KV422 SQL-safety errors must force exitCode 1`;

export function filterSinkPolicyCiFindings(findings, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const compileText = readText(drizzleStaticCompilePath);
  if (!hasDrizzleStaticSqlSafetyExitInvariant(compileText)) return findings;
  return findings.filter((finding) => finding !== drizzleStaticExitFinding);
}

export function hasDrizzleStaticSqlSafetyExitInvariant(text) {
  const source = stripCommentsAndStringContents(text);
  return (
    /\bif\s*\(\s*sqlSafetyErrors\s*\.\s*length\s*>\s*0\s*&&\s*artifact\s*\.\s*exitCode\s*===\s*0\s*\)\s*\{[\s\S]{0,600}\breturn\s*\{[\s\S]{0,300}\bexitCode\s*:\s*1\b/.test(
      source,
    ) ||
    (/\bfunction\s+drizzleStaticSqlSafetyErrorExit\s*\([^)]*\)\s*:[^{]+\{[\s\S]{0,200}\bif\s*\(\s*sqlSafetyErrors\s*\.\s*length\s*>\s*0\s*\)\s*return\s*\{[^}]*\bexitCode\s*:\s*1\b/.test(
      source,
    ) &&
      /\bconst\s+sqlSafetyExit\s*=\s*drizzleStaticSqlSafetyErrorExit\s*\(\s*sqlSafetyErrors\s*\)[\s\S]{0,240}\bif\s*\(\s*sqlSafetyExit\s*&&\s*artifact\s*\.\s*exitCode\s*===\s*0\s*\)\s*\{[\s\S]{0,240}\.\.\.\s*sqlSafetyExit\b/.test(
        source,
      ))
  );
}

function stripCommentsAndStringContents(text) {
  let output = '';
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        output += '\n';
      } else {
        output += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      output += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += ' ';
      continue;
    }

    output += char;
  }

  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = filterSinkPolicyCiFindings(checkSinkPolicyGate());
  if (findings.length > 0) {
    console.error(`Sink policy gate failed with ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log('Sink policy gate passed.');
}
