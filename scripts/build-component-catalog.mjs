#!/usr/bin/env node
// Combines the independently generated UI/headless and icon catalogs into one
// searchable artifact. The package generators remain the owning sources.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { combineComponentCatalogDocuments } from './component-catalog-schema.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const inputs = [
  path.join(repoRoot, 'packages/ui/catalog.json'),
  path.join(repoRoot, 'packages/icons/catalog.json'),
];
const outputPath = path.join(repoRoot, 'catalog/component-icon-catalog.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function generatedCatalog() {
  const document = combineComponentCatalogDocuments(inputs.map(readJson));
  const componentCount = document.entries.filter((entry) => entry.kind === 'component').length;
  const iconCount = document.entries.filter((entry) => entry.kind === 'icon').length;
  if (componentCount !== 44 || iconCount !== 1_737) {
    throw new Error(
      `Combined catalog expected 44 components and 1737 icons, got ${componentCount} and ${iconCount}`,
    );
  }
  return document;
}

const expected = `${JSON.stringify(generatedCatalog(), null, 2)}\n`;
if (process.argv.includes('--write')) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, expected, 'utf8');
  process.stdout.write('Wrote catalog/component-icon-catalog.json (44 components, 1737 icons).\n');
} else {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== expected) {
    throw new Error(
      'catalog/component-icon-catalog.json is stale; run `node scripts/build-component-catalog.mjs --write`',
    );
  }
  process.stdout.write('Combined component/icon catalog is up to date (44 + 1737 entries).\n');
}
