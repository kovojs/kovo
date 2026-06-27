#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const findings = [];

for (const file of sourceFiles(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  const relativeFile = relative(root, file);
  const lines = source.split('\n');
  let inImportStatement = false;

  for (const [index, line] of lines.entries()) {
    const text = stripLineComment(line);
    if (/^\s*(?:\/\*|\*|\*\/)/.test(text)) continue;
    if (inImportStatement || startsImportStatement(text)) {
      inImportStatement = !endsImportStatement(text);
      continue;
    }
    if (/\bany\b/.test(text)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans any`);
    }
    if (/\bas\s+(?!const\b)[A-Za-z_{]/.test(text)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans unchecked casts`);
    }
    if (hasNonNullAssertion(text)) {
      findings.push(
        `${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans non-null assertions`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error(`Kovo starter sound-subset check failed:\n${findings.join('\n')}`);
  process.exit(1);
}

console.log('Kovo starter sound-subset check passed.');

function sourceFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) return sourceFiles(path);
      return /\.[cm]?tsx?$/.test(entry) ? [path] : [];
    })
    .sort();
}

function stripLineComment(line) {
  const index = line.indexOf('//');
  return index === -1 ? line : line.slice(0, index);
}

function startsImportStatement(line) {
  return /^\s*import\b/.test(line);
}

function endsImportStatement(line) {
  return /;\s*$/.test(line);
}

function hasNonNullAssertion(line) {
  return /[A-Za-z0-9_$)\]]!\s*(?:[.;,\])}]|\?|$)/.test(line);
}
