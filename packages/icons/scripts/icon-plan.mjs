import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPONENT_CATALOG_SCHEMA,
  validateComponentCatalogDocument,
} from '../../../scripts/component-catalog-schema.mjs';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const pkgDir = path.join(repoRoot, 'packages/icons');
export const pkgJsonPath = path.join(pkgDir, 'package.json');

const compactExports = {
  '.': './src/index.tsx',
  './index': null,
  './*': './src/*.tsx',
};

const compactPublishExports = {
  '.': {
    types: './dist/index.d.mts',
    default: './dist/index.mjs',
  },
  './index': null,
  './*': {
    types: './dist/*.d.mts',
    default: './dist/*.mjs',
  },
};

// Hand-authored source files in src/ the generator must never delete.
export const PRESERVED_TSX = new Set(['index.tsx']);
const SHADOW_RESTRICTED_NAMES = new Set(['Infinity', 'NaN', 'undefined', 'eval', 'arguments']);

export function lucideIconNodes() {
  const require = createRequire(pkgJsonPath);
  const pkgPath = require.resolve('lucide-static/package.json');
  const nodesPath = path.join(path.dirname(pkgPath), 'icon-nodes.json');
  return JSON.parse(readFileSync(nodesPath, 'utf8'));
}

export function toSymbol(name) {
  const symbol = name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(symbol) ? `Icon${symbol}` : symbol;
}

function toTitle(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function attrValue(value) {
  const text = String(value);
  if (/[<>&"]/.test(text)) {
    throw new Error(`build-icons: unsafe attribute value ${JSON.stringify(text)}`);
  }
  return text;
}

function renderChild(node) {
  if (!Array.isArray(node) || typeof node[0] !== 'string') {
    throw new Error(`build-icons: malformed icon node ${JSON.stringify(node)}`);
  }
  const [tag, attrs = {}] = node;
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${attrValue(value)}"`)
    .join('');
  return `      <${tag}${attrText}></${tag}>`;
}

function iconSource(name, nodes) {
  const symbol = toSymbol(name);
  const lintSuppression = SHADOW_RESTRICTED_NAMES.has(symbol)
    ? '// eslint-disable-next-line no-shadow-restricted-names -- Generated public Lucide icon export.\n'
    : '';
  const children = nodes.map(renderChild).join('\n');
  const svg =
    children.length > 0
      ? `    <svg {...iconRootAttrs(props)}>\n${children}\n    </svg>`
      : `    <svg {...iconRootAttrs(props)}></svg>`;
  return (
    `/** @jsxImportSource @kovojs/server */\n` +
    `import type { ComponentRenderResult } from '@kovojs/core';\n` +
    `import { iconRootAttrs, type IconProps } from './icon-base.js';\n` +
    `\n` +
    `/** ${toTitle(name)} icon (Lucide). https://lucide.dev/icons/${name} */\n` +
    lintSuppression +
    `export function ${symbol}(props: IconProps = {}): ComponentRenderResult {\n` +
    `  return (\n` +
    `${svg}\n` +
    `  );\n` +
    `}\n`
  );
}

export function iconNames() {
  return Object.keys(lucideIconNodes()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function iconSubpath(name) {
  return `./${name}`;
}

export function iconSourceTarget(name) {
  return `./src/${name}.tsx`;
}

export function iconDistStem(name) {
  return name;
}

export function iconSourceTargetForSubpath(subpath) {
  if (subpath === '.') return './src/index.tsx';
  if (!isIconSubpath(subpath)) return null;
  return iconSourceTarget(subpath.slice(2));
}

export function isIconSubpath(subpath) {
  return /^\.\/[a-z0-9-]+$/.test(subpath) && subpath !== './index';
}

export function iconPackageExports() {
  return compactExports;
}

export function iconPublishExports() {
  return compactPublishExports;
}

export function iconPackEntries(names = iconNames()) {
  return ['src/index.tsx', ...names.map((name) => `src/${name}.tsx`)];
}

export function iconDistTargets(names = iconNames()) {
  return [
    'dist/index.d.mts',
    'dist/index.mjs',
    ...names.flatMap((name) => [
      `dist/${iconDistStem(name)}.d.mts`,
      `dist/${iconDistStem(name)}.mjs`,
    ]),
  ];
}

export function publicIconSubpaths(names = iconNames()) {
  return ['.', ...names.map(iconSubpath)];
}

export function iconCatalogDocument(names = iconNames()) {
  const entries = names
    .map((name) => {
      const title = toTitle(name);
      return {
        anatomy: null,
        copyCommand: null,
        enhancement: {
          accessibility:
            'Decorative by default; aria-label or title promotes the SVG to an accessible image.',
          keyboard: 'No custom keyboard behavior; icons never add an interactive focus target.',
          roles: ['img'],
          tier: 'none',
        },
        id: `icon:${name}`,
        kind: 'icon',
        name,
        packageImport: `@kovojs/icons/${name}`,
        searchText: [
          name,
          title,
          `@kovojs/icons/${name}`,
          'Lucide SVG icon glyph decorative accessible image',
        ].join(' '),
        summary: `${title} Lucide SVG icon.`,
        title,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const document = {
    schema: COMPONENT_CATALOG_SCHEMA,
    owner: '@kovojs/icons',
    entries,
  };
  const findings = validateComponentCatalogDocument(document);
  if (findings.length > 0) {
    throw new Error(`Unable to generate packages/icons/catalog.json:\n${findings.join('\n')}`);
  }
  return document;
}

export function computeIconPlan() {
  const iconNodes = lucideIconNodes();
  const names = Object.keys(iconNodes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const files = new Map();
  const bySymbol = new Map();
  for (const name of names) {
    const symbol = toSymbol(name);
    if (bySymbol.has(symbol)) {
      throw new Error(
        `build-icons: symbol collision ${symbol} from "${name}" and "${bySymbol.get(symbol)}"`,
      );
    }
    bySymbol.set(symbol, name);
    files.set(`${name}.tsx`, iconSource(name, iconNodes[name]));
  }

  return {
    names,
    files,
    exportsMap: iconPackageExports(),
    publishExports: iconPublishExports(),
    publicSubpaths: publicIconSubpaths(names),
    catalog: iconCatalogDocument(names),
    packEntries: iconPackEntries(names),
    distTargets: iconDistTargets(names),
  };
}
