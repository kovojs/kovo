#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOTS = ['packages/compiler/src', 'packages/drizzle/src'];
const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx']);

const CATEGORY_PATTERNS = [
  {
    key: 'literalTextComparisons',
    label: 'literal getText()/text comparisons',
    pattern:
      /(?:\bgetText\(\)|\b[A-Za-z0-9_$)]+\.text)\s*(?:={2,3}|!={1,2})\s*['"`][^'"`]+['"`]|['"`][^'"`]+['"`]\s*(?:={2,3}|!={1,2})\s*(?:\bgetText\(\)|\b[A-Za-z0-9_$)]+\.text)\b/u,
  },
  {
    key: 'importSpecifierComparisons',
    label: 'import/local specifier comparisons',
    pattern:
      /\b(?:moduleSpecifier(?:\.text)?|importedName|localName)\s*(?:={2,3}|!={1,2})\s*['"`][^'"`]+['"`]/u,
  },
  {
    key: 'astKindGates',
    label: 'AST-kind gates',
    pattern: /\b(?:ts|Node)\.is[A-Z][A-Za-z0-9_]*\(/u,
  },
  {
    key: 'kv406FailClosedSites',
    label: 'KV406/fail-closed sites',
    pattern:
      /\b(?:KV406|UNCLASSIFIED|un-analyzable|fail-closed|degrades? to KV406|opaque[^'\n]*KV406|code:\s*'KV406')\b/u,
  },
];

export function inventorySource(source, filePath = '<inline>') {
  const entries = [];
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const category of CATEGORY_PATTERNS) {
      if (!category.pattern.test(line)) continue;
      entries.push({
        category: category.key,
        file: normalizeRelativeFile(filePath),
        line: index + 1,
        text: line.trim(),
      });
    }
  }
  return entries;
}

export async function collectInventory(options = {}) {
  const root = options.root ?? process.cwd();
  const includeTests = options.includeTests === true;
  const roots = options.roots ?? DEFAULT_ROOTS;
  const files = [];
  for (const sourceRoot of roots) {
    files.push(...(await sourceFiles(path.resolve(root, sourceRoot), { includeTests })));
  }

  const entries = [];
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const source = await readFile(file, 'utf8');
    entries.push(...inventorySource(source, path.relative(root, file)));
  }

  return summarizeInventory(entries, { files, includeTests, roots });
}

export function summarizeInventory(entries, metadata = {}) {
  const categories = Object.fromEntries(
    CATEGORY_PATTERNS.map((category) => [
      category.key,
      {
        label: category.label,
        count: entries.filter((entry) => entry.category === category.key).length,
      },
    ]),
  );
  const syntacticRecognitionCandidates =
    categories.literalTextComparisons.count + categories.importSpecifierComparisons.count;

  return {
    roots: metadata.roots ?? DEFAULT_ROOTS,
    includeTests: metadata.includeTests === true,
    filesScanned: metadata.files?.length ?? unique(entries.map((entry) => entry.file)).length,
    syntacticRecognitionCandidates,
    categories,
    entries: entries.sort((a, b) => {
      const fileDelta = a.file.localeCompare(b.file);
      if (fileDelta) return fileDelta;
      return a.line - b.line || a.category.localeCompare(b.category);
    }),
  };
}

export function formatInventoryReport(report) {
  const lines = [
    'fundamental-fixes inventory',
    `roots: ${report.roots.join(', ')}`,
    `includeTests: ${String(report.includeTests)}`,
    `filesScanned: ${report.filesScanned}`,
    `syntacticRecognitionCandidates: ${report.syntacticRecognitionCandidates}`,
  ];
  for (const [key, value] of Object.entries(report.categories)) {
    lines.push(`${key}: ${value.count} (${value.label})`);
  }
  return `${lines.join('\n')}\n`;
}

async function sourceFiles(root, options) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!DEFAULT_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (!options.includeTests && isTestFile(full)) continue;
      files.push(full);
    }
  }
  await walk(root);
  return files;
}

function shouldSkipDirectory(name) {
  return name === 'node_modules' || name === 'dist' || name === 'coverage' || name === '.git';
}

function isTestFile(file) {
  return /\.(?:test|spec)\.(?:ts|tsx)$/u.test(file) || file.endsWith('.data.ts');
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeRelativeFile(file) {
  return file.split(path.sep).join('/');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const report = await collectInventory({
    includeTests: args.has('--include-tests'),
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatInventoryReport(report));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
