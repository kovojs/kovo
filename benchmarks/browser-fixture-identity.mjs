import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../scripts/lib/perf-host.mjs';

export const BROWSER_FIXTURE_IDENTITY_SCHEMA = 'kovo-browser-fixture-identity/v1';
export const BROWSER_FIXTURE_RENDERED_EVIDENCE_SCHEMA =
  'kovo-browser-fixture-rendered-evidence/v1';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const CATALOG_FIELDS = Object.freeze([
  'id',
  'slug',
  'name',
  'price',
  'blurb',
  'img',
]);
const CSS_FACTS = Object.freeze({
  bodyBackground: 'rgb(247, 247, 244)',
  bodyColor: 'rgb(32, 35, 31)',
  cardDisplay: 'grid',
  cardImageAspectRatio: '4 / 3',
  navPosition: 'sticky',
});
const MATCHED_ROUTE_SPECS = Object.freeze([
  Object.freeze({
    basePath: '/matched/l0',
    kovoPath: '/matched/l0',
    lane: 'matched-l0',
    nextPage: '(matched-l0)/matched/l0/page.tsx',
    route: 'listing',
  }),
  Object.freeze({
    basePath: '/matched/l0',
    kovoPath: '/matched/l0/product/:slug',
    lane: 'matched-l0',
    nextPage: '(matched-l0)/matched/l0/product/[slug]/page.tsx',
    route: 'detail',
  }),
  Object.freeze({
    basePath: '/matched/l1',
    kovoPath: '/matched/l1',
    lane: 'matched-l1',
    nextPage: '(matched-l1)/matched/l1/page.tsx',
    route: 'listing',
  }),
  Object.freeze({
    basePath: '/matched/l1',
    kovoPath: '/matched/l1/product/:slug',
    lane: 'matched-l1',
    nextPage: '(matched-l1)/matched/l1/product/[slug]/page.tsx',
    route: 'detail',
  }),
  Object.freeze({
    basePath: '/matched/l0',
    kovoPath: '/matched/runtime/dynamic',
    lane: 'matched-runtime',
    nextPage: '(matched-runtime)/matched/runtime/dynamic/page.tsx',
    route: 'listing',
  }),
  Object.freeze({
    basePath: '/matched/l0',
    kovoPath: '/matched/runtime/dynamic/product/:slug',
    lane: 'matched-runtime',
    nextPage: '(matched-runtime)/matched/runtime/dynamic/product/[slug]/page.tsx',
    route: 'detail',
  }),
]);

let defaultIdentityPromise;

/**
 * Build the capability-matched browser fixture identity from its authoritative data, CSS, and
 * entrant source projections. The source topology is recorded, not normalized away: Kovo's local
 * catalog literal and framework-native module topology are part of the workload identity even
 * though both entrants must project the same rendered contract.
 */
export async function browserFixtureIdentity(options = {}) {
  if (Object.keys(options).length === 0) {
    defaultIdentityPromise ??= createBrowserFixtureIdentity();
    return await defaultIdentityPromise;
  }
  return await createBrowserFixtureIdentity(options);
}

export async function createBrowserFixtureIdentity({ overrides = {}, root = benchmarkRoot } = {}) {
  const relativeFiles = fixtureSourceFiles();
  const entries = await Promise.all(
    relativeFiles.map(async (relativePath) => {
      const source =
        Object.hasOwn(overrides, relativePath)
          ? String(overrides[relativePath])
          : await readFile(path.join(root, relativePath), 'utf8');
      return [relativePath, source];
    }),
  );
  const sources = Object.fromEntries(entries);
  const findings = [];
  const fixture = parseJsonSource(sources['shared/matched-fixture.json'], 'matched fixture', findings);
  const catalog = parseJsonSource(sources['shared/catalog.json'], 'catalog', findings);
  const normalizedCatalog = normalizeCatalog(catalog, findings);

  if (fixture?.schema !== 'kovo-benchmark-matched-fixture/v1') {
    findings.push('matched fixture schema is absent or unsupported');
  }
  if (fixture?.catalogItems !== normalizedCatalog.length) {
    findings.push('matched fixture catalog count does not match the authoritative catalog');
  }
  for (const name of ['brand', 'detailBackLabel', 'listingDescription', 'listingHeading']) {
    if (typeof fixture?.[name] !== 'string' || fixture[name].length === 0) {
      findings.push(`matched fixture ${name} is absent`);
    }
  }

  const kovoCatalog = extractKovoCatalog(sources['kovo/src/app.tsx'], findings);
  const expectedKovoCatalog = normalizedCatalog.map(kovoCatalogProjection);
  if (canonicalJson(kovoCatalog) !== canonicalJson(expectedKovoCatalog)) {
    findings.push('Kovo catalog literal does not exactly project the authoritative catalog');
  }

  validateEntrantSources({ findings, fixture, normalizedCatalog, sources });

  const authority = Object.fromEntries(
    ['shared/matched-fixture.json', 'shared/catalog.json', 'shared/styles.css'].map(
      (relativePath) => [relativePath, sourceEvidence(sources[relativePath])],
    ),
  );
  const sourceProjection = sourceShapeProjection(sources);
  const renderedContracts = Object.fromEntries(
    ['default', 'matched-l0', 'matched-l1'].map((lane) => {
      const contract = renderedFixtureContract({ catalog: normalizedCatalog, fixture, lane });
      return [
        lane,
        {
          digest: sha256(canonicalJson(contract)),
          schema: BROWSER_FIXTURE_RENDERED_EVIDENCE_SCHEMA,
        },
      ];
    }),
  );
  const identity = {
    authority,
    css: {
      facts: CSS_FACTS,
      kovoPosture: 'byte-identical-to-authoritative-shared-css',
      nextjsPosture: 'exact-import-of-authoritative-shared-css',
    },
    renderedContracts,
    schema: BROWSER_FIXTURE_IDENTITY_SCHEMA,
    semanticCorpus: {
      catalogItems: normalizedCatalog.length,
      catalogSha256: authority['shared/catalog.json'].sha256,
      routeKinds: ['listing', 'detail'],
      routes: MATCHED_ROUTE_SPECS,
      sharedCssSha256: authority['shared/styles.css'].sha256,
    },
    sourceProjection,
  };
  const uniqueFindings = [...new Set(findings)].sort();
  return {
    complete: uniqueFindings.length === 0,
    digest: sha256(canonicalJson(identity)),
    findings: uniqueFindings,
    identity,
    schema: BROWSER_FIXTURE_IDENTITY_SCHEMA,
  };
}

/**
 * Authenticate one rendered listing projection against the same contract carried by the workload
 * identity. Only canonical observable facts participate; framework-owned script topology remains a
 * separate capability assertion in the browser comparator.
 */
export function renderedBrowserFixtureEvidence(observed, identity, { lane }) {
  const expected = renderedFixtureContract({
    catalog: identity?.catalog,
    fixture: identity?.fixture,
    lane,
  });
  const normalized = normalizeRenderedObservation(observed, lane);
  const findings = renderedObservationFindings(normalized, expected);
  const expectedDigest = sha256(canonicalJson(expected));
  const observedDigest = sha256(canonicalJson(normalized));
  return {
    expectedDigest,
    findings,
    observedDigest,
    schema: BROWSER_FIXTURE_RENDERED_EVIDENCE_SCHEMA,
    validated: findings.length === 0 && observedDigest === expectedDigest,
  };
}

export async function browserFixtureRuntimeContract() {
  const result = await browserFixtureIdentity();
  const fixture = JSON.parse(await readFile(path.join(benchmarkRoot, 'shared/matched-fixture.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(benchmarkRoot, 'shared/catalog.json'), 'utf8'));
  return {
    catalog: normalizeCatalog(catalog, []),
    fixture,
    identity: result,
  };
}

function fixtureSourceFiles() {
  return [
    'shared/matched-fixture.json',
    'shared/catalog.json',
    'shared/styles.css',
    'kovo/src/app.tsx',
    'kovo/src/matched-l1-shell.tsx',
    'kovo/src/styles.css',
    'nextjs/app/globals.css',
    'nextjs/app/_matched/content.tsx',
    'nextjs/app/_matched/l0-shell.tsx',
    'nextjs/app/_matched/l1-shell.tsx',
    ...MATCHED_ROUTE_SPECS.map(({ nextPage }) => `nextjs/app/${nextPage}`),
  ];
}

function parseJsonSource(source, label, findings) {
  try {
    return JSON.parse(source);
  } catch {
    findings.push(`${label} JSON is malformed`);
    return null;
  }
}

function normalizeCatalog(value, findings) {
  if (!Array.isArray(value)) {
    findings.push('authoritative catalog is not an array');
    return [];
  }
  const output = [];
  const ids = new Set();
  const slugs = new Set();
  for (const [index, product] of value.entries()) {
    const normalized = {};
    for (const field of CATALOG_FIELDS) {
      const fieldValue = product?.[field];
      const valid =
        field === 'price'
          ? Number.isSafeInteger(fieldValue) && fieldValue >= 0
          : typeof fieldValue === 'string' && fieldValue.length > 0;
      if (!valid) findings.push(`catalog[${String(index)}].${field} is invalid`);
      normalized[field] = fieldValue;
    }
    if (ids.has(normalized.id)) findings.push(`catalog id ${String(normalized.id)} is duplicated`);
    if (slugs.has(normalized.slug)) {
      findings.push(`catalog slug ${String(normalized.slug)} is duplicated`);
    }
    ids.add(normalized.id);
    slugs.add(normalized.slug);
    output.push(normalized);
  }
  return output;
}

function kovoCatalogProjection(product) {
  return {
    blurb: product.blurb,
    href: `/product/${product.slug}`,
    id: product.id,
    img: product.img,
    matchedL0Href: `/matched/l0/product/${product.slug}`,
    matchedL1Href: `/matched/l1/product/${product.slug}`,
    name: product.name,
    price: product.price,
    priceLabel: priceLabel(product.price),
    slug: product.slug,
    viewLabel: `View ${product.name}`,
  };
}

function extractKovoCatalog(source, findings) {
  const marker = 'const catalog = [';
  const start = source.indexOf(marker);
  const end = source.indexOf('] as const;', start + marker.length);
  if (start < 0 || end < 0) {
    findings.push('Kovo catalog literal boundary is absent');
    return [];
  }
  const body = source.slice(start + marker.length, end);
  const objects = splitTopLevelObjects(body);
  if (objects.length === 0) findings.push('Kovo catalog literal has no products');
  return objects.map((objectSource, index) => {
    const output = {};
    for (const field of [
      'id',
      'slug',
      'href',
      'matchedL0Href',
      'matchedL1Href',
      'name',
      'viewLabel',
      'price',
      'priceLabel',
      'blurb',
      'img',
    ]) {
      const value = literalProperty(objectSource, field);
      if (value === undefined) findings.push(`Kovo catalog[${String(index)}].${field} is absent`);
      output[field] = value;
    }
    return output;
  });
}

function splitTopLevelObjects(source) {
  const output = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) output.push(source.slice(start, index + 1));
    }
  }
  return output;
}

function literalProperty(source, name) {
  const match = new RegExp(
    `(?:^|\\n)\\s*${name}\\s*:\\s*(?:'((?:\\\\.|[^'])*)'|"((?:\\\\.|[^"])*)"|(-?\\d+))`,
    'u',
  ).exec(source);
  if (!match) return undefined;
  if (match[3] !== undefined) return Number(match[3]);
  const quote = match[1] === undefined ? '"' : "'";
  const value = match[1] ?? match[2];
  return decodeQuotedLiteral(value, quote);
}

function decodeQuotedLiteral(value, quote) {
  if (quote === '"') return JSON.parse(`"${value}"`);
  return value
    .replace(/\\'/gu, "'")
    .replace(/\\\\/gu, '\\')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t');
}

function validateEntrantSources({ findings, fixture, normalizedCatalog, sources }) {
  const kovoApp = sources['kovo/src/app.tsx'];
  const kovoL1 = sources['kovo/src/matched-l1-shell.tsx'];
  const nextContent = sources['nextjs/app/_matched/content.tsx'];
  const nextL0 = sources['nextjs/app/_matched/l0-shell.tsx'];
  const nextL1 = sources['nextjs/app/_matched/l1-shell.tsx'];

  if (sources['kovo/src/styles.css'] !== sources['shared/styles.css']) {
    findings.push('Kovo stylesheet is not byte-identical to the authoritative shared CSS');
  }
  if (sources['nextjs/app/globals.css'].trim() !== "@import '../../shared/styles.css';") {
    findings.push('Next.js stylesheet does not exactly import the authoritative shared CSS');
  }
  const css = sources['shared/styles.css'];
  for (const [selector, property, value] of [
    ['body', 'background', '#f7f7f4'],
    ['body', 'color', '#20231f'],
    ['.card', 'display', 'grid'],
    ['.card img,', 'aspect-ratio', '4 / 3'],
    ['.nav', 'position', 'sticky'],
    ['[popover]:not(:popover-open)', 'display', 'none'],
  ]) {
    if (cssDeclaration(css, selector, property) !== value) {
      findings.push(`authoritative CSS fact ${selector} ${property}: ${value} is absent`);
    }
  }
  if (!nextContent.includes("import catalog from '../../../shared/catalog.json';")) {
    findings.push('Next.js matched content does not import the authoritative catalog');
  }
  for (const field of ['blurb', 'id', 'img', 'name', 'price', 'slug']) {
    if (!nextContent.includes(`product.${field}`)) {
      findings.push(`Next.js matched content does not project catalog field ${field}`);
    }
  }
  if (!nextContent.includes('const href = `${basePath}/product/${product.slug}`;')) {
    findings.push('Next.js matched content does not derive exact lane-local product hrefs');
  }
  if (!nextContent.includes('`$${value.toFixed(2)}`')) {
    findings.push('Next.js matched content does not project canonical two-decimal prices');
  }
  for (const text of [fixture?.brand, fixture?.listingHeading, fixture?.listingDescription]) {
    if (typeof text !== 'string') continue;
    if (!kovoApp.includes(text)) findings.push(`Kovo source omitted shared fact ${JSON.stringify(text)}`);
    if (!(nextContent + nextL0 + nextL1).includes(text)) {
      findings.push(`Next.js source omitted shared fact ${JSON.stringify(text)}`);
    }
  }
  for (const text of [fixture?.l0?.cartDescription, fixture?.l0?.cartLabel, fixture?.l0?.cartText]) {
    if (typeof text !== 'string') {
      findings.push('matched L0 control facts are incomplete');
      continue;
    }
    if (!kovoApp.includes(text)) findings.push(`Kovo L0 omitted ${JSON.stringify(text)}`);
    if (!nextL0.includes(text)) findings.push(`Next.js L0 omitted ${JSON.stringify(text)}`);
  }
  for (const text of [
    fixture?.l1?.alternateEmail,
    fixture?.l1?.cartDescription,
    fixture?.l1?.initialEmail,
    fixture?.l1?.itemLabel,
    fixture?.l1?.itemPrice,
  ]) {
    if (typeof text !== 'string') {
      findings.push('matched L1 state facts are incomplete');
      continue;
    }
    if (!kovoL1.includes(text)) findings.push(`Kovo L1 omitted ${JSON.stringify(text)}`);
    if (!nextL1.includes(text)) findings.push(`Next.js L1 omitted ${JSON.stringify(text)}`);
  }
  if (!kovoApp.includes('popovertarget="matched-l0-cart"')) {
    findings.push('Kovo matched L0 native popover control is absent');
  }
  if (!nextL0.includes('popoverTarget="matched-l0-cart"') || nextL0.includes("'use client'")) {
    findings.push('Next.js matched L0 native/no-client source posture is absent');
  }
  for (const state of ['count', 'email', 'open', 'ordered']) {
    if (!new RegExp(`\\b${state}:`, 'u').test(kovoL1)) findings.push(`Kovo L1 state ${state} is absent`);
    if (!new RegExp(`\\[${state}, set${capitalize(state)}\\]`, 'u').test(nextL1)) {
      findings.push(`Next.js L1 state ${state} is absent`);
    }
  }
  for (const spec of MATCHED_ROUTE_SPECS) {
    if (!kovoApp.includes(`app.route('${spec.kovoPath}'`)) {
      findings.push(`Kovo route ${spec.kovoPath} is absent`);
    }
    const nextSource = sources[`nextjs/app/${spec.nextPage}`];
    if (typeof nextSource !== 'string' || !nextSource.includes(spec.basePath)) {
      findings.push(`Next.js route projection ${spec.nextPage} is absent or misbound`);
    }
  }
  if (normalizedCatalog.length !== 24) findings.push('browser fixture catalog does not contain 24 products');
}

function sourceShapeProjection(sources) {
  const kovoFiles = ['kovo/src/app.tsx', 'kovo/src/matched-l1-shell.tsx'];
  const nextFiles = [
    'nextjs/app/_matched/content.tsx',
    'nextjs/app/_matched/l0-shell.tsx',
    'nextjs/app/_matched/l1-shell.tsx',
    ...MATCHED_ROUTE_SPECS.map(({ nextPage }) => `nextjs/app/${nextPage}`),
  ];
  const project = (files, catalogPosture) => ({
    approximateLoc: files.reduce((sum, name) => sum + lineCount(sources[name]), 0),
    catalogPosture,
    files: Object.fromEntries(files.map((name) => [name, sourceEvidence(sources[name])])),
    moduleCount: files.length,
    routeCount: MATCHED_ROUTE_SPECS.length,
  });
  return {
    equalityPosture:
      'equal-route-and-rendered-contract;framework-native-module-and-authored-loc-recorded-not-normalized',
    kovo: project(kovoFiles, 'compiler-constrained-exact-local-literal'),
    nextjs: project(nextFiles, 'direct-authoritative-json-import'),
  };
}

function renderedFixtureContract({ catalog, fixture, lane }) {
  const products = (catalog ?? []).map((product) => ({
    blurb: product.blurb,
    href: `${lane === 'default' ? '' : `/${lane.replace('matched-', 'matched/')}`}/product/${product.slug}`,
    img: product.img,
    name: product.name,
    price: priceLabel(product.price),
    viewLabel: `View ${product.name}`,
  }));
  const shared = {
    css: CSS_FACTS,
    heading: fixture?.listingHeading,
    lane,
    products,
  };
  if (lane === 'matched-l0') {
    shared.description = fixture?.listingDescription;
    shared.shell = {
      brand: fixture?.brand,
      cartDescription: fixture?.l0?.cartDescription,
      cartLabel: fixture?.l0?.cartLabel,
      cartText: fixture?.l0?.cartText,
    };
  } else if (lane === 'matched-l1') {
    shared.description = fixture?.listingDescription;
    shared.shell = {
      brand: fixture?.brand,
      cartDescription: fixture?.l1?.cartDescription,
      cartLabel: 'Open cart with 0 items',
      cartText: 'Cart (0)',
    };
  }
  return shared;
}

function normalizeRenderedObservation(observed, lane) {
  const normalized = {
    css: Object.fromEntries(Object.keys(CSS_FACTS).map((name) => [name, observed?.css?.[name] ?? null])),
    heading: observed?.heading ?? null,
    lane: observed?.lane ?? null,
    products: Array.isArray(observed?.products)
      ? observed.products.map((product) => ({
          blurb: product?.blurb ?? null,
          href: product?.href ?? null,
          img: product?.img ?? null,
          name: product?.name ?? null,
          price: product?.price ?? null,
          viewLabel: product?.viewLabel ?? null,
        }))
      : [],
  };
  if (lane === 'matched-l0' || lane === 'matched-l1') {
    normalized.description = observed?.description ?? null;
    normalized.shell = {
      brand: observed?.shell?.brand ?? null,
      cartDescription: observed?.shell?.cartDescription ?? null,
      cartLabel: observed?.shell?.cartLabel ?? null,
      cartText: observed?.shell?.cartText ?? null,
    };
  }
  return normalized;
}

function renderedObservationFindings(observed, expected) {
  if (canonicalJson(observed) === canonicalJson(expected)) return [];
  const findings = [];
  if (observed.lane !== expected.lane) findings.push('rendered lane identity mismatch');
  if (observed.heading !== expected.heading) findings.push('rendered listing heading mismatch');
  if (canonicalJson(observed.css) !== canonicalJson(expected.css)) {
    findings.push('rendered CSS projection mismatch');
  }
  if (canonicalJson(observed.products) !== canonicalJson(expected.products)) {
    findings.push('rendered 24-product projection mismatch');
  }
  if (canonicalJson(observed.shell) !== canonicalJson(expected.shell)) {
    findings.push('rendered shell/control projection mismatch');
  }
  if (observed.description !== expected.description) {
    findings.push('rendered listing description mismatch');
  }
  return findings;
}

function sourceEvidence(source) {
  return { bytes: Buffer.byteLength(source), lines: lineCount(source), sha256: sha256(source) };
}

function cssDeclaration(source, selector, property) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex < 0) return null;
  const open = source.indexOf('{', selectorIndex + selector.length);
  const close = source.indexOf('}', open + 1);
  if (open < 0 || close < 0) return null;
  const match = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+);`, 'u').exec(
    source.slice(open + 1, close),
  );
  return match?.[1]?.trim() ?? null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function lineCount(source) {
  return source === '' ? 0 : source.split('\n').length;
}

function priceLabel(price) {
  return `$${Number(price).toFixed(2)}`;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
