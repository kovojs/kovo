import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compilerSourceModuleSpecifiers,
  createCompilerSourceFileSystem,
  type CompilerSourceFileSystem,
} from '@kovojs/compiler/internal/source-filesystem';

import { KOVO_ADD_COMPONENT_NAMES, type AddComponentName } from './add-component-names.js';

export interface VendoredUiFile {
  fileName: string;
  requiredPackageDependencies: readonly string[];
  source: string;
  sourceHash: string;
}

export interface VendoredUiComponent {
  fileName: `${string}.tsx`;
  files: readonly VendoredUiFile[];
  packageVersion: string;
  requiredPackageDependencies: readonly string[];
  source: string;
  sourceHash: string;
}

interface UiPackageManifest {
  exports?: Record<string, UiPackageExportTarget>;
  kovo?: {
    vendoredSource?: boolean;
    vendoredSourceHashes?: Record<string, string>;
    vendoredSourceHelperHashes?: Record<string, string>;
  };
  name?: string;
  version?: string;
}

type UiPackageExportTarget = string | Record<string, string>;

const catalogModuleDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const catalogRequire = createRequire(import.meta.url);
const uiPackageRoot = findUiPackageRoot(catalogModuleDir);
const uiPackageManifestPath = join(uiPackageRoot, 'package.json');
const maximumUiManifestBytes = 1024 * 1024;
const maximumVendoredSourceBytes = 2 * 1024 * 1024;
const maximumVendoredHelperSourceCount = 16;
const vendoredSourceHashPattern = /^sha256-[A-Za-z0-9_-]{43}$/;
const vendoredHelperSourcePathPattern = /^src\/[a-z][a-z0-9-]*\.ts$/;
const uiPackageFileSystem = createCompilerSourceFileSystem(uiPackageRoot);
if (uiPackageFileSystem === null) {
  throw new Error(`@kovojs/ui vendored catalog root is unavailable: ${uiPackageRoot}`);
}
const uiPackageManifest = readUiPackageManifest(uiPackageFileSystem);

const vendoredUiComponentEntries = uiPackageComponentEntries(uiPackageManifest, uiPackageRoot);
assertFiniteComponentCatalog(vendoredUiComponentEntries);
const authenticatedUiPackageSources = authenticateVendoredUiPackageSources(
  uiPackageManifest,
  vendoredUiComponentEntries,
  uiPackageRoot,
  uiPackageFileSystem,
);
export const vendoredUiComponents = Object.freeze(
  Object.fromEntries(
    vendoredUiComponentEntries.map(([name, sourcePath]) => [
      name,
      readVendoredComponent(name, sourcePath, authenticatedUiPackageSources),
    ]),
  ),
) as Readonly<Record<AddComponentName, VendoredUiComponent>>;

export type { AddComponentName } from './add-component-names.js';

export function availableAddComponents(): string {
  return Object.keys(vendoredUiComponents).sort().join(', ');
}

export function isAddComponentName(value: string): value is AddComponentName {
  return Object.hasOwn(vendoredUiComponents, value);
}

function assertFiniteComponentCatalog(entries: readonly [string, string][]): void {
  const actual = entries.map(([name]) => name);
  if (
    actual.length !== KOVO_ADD_COMPONENT_NAMES.length ||
    actual.some((name, index) => name !== KOVO_ADD_COMPONENT_NAMES[index])
  ) {
    throw new Error(
      '@kovojs/ui exports and the semantic kovo add component enum must be updated together',
    );
  }
}

function readUiPackageManifest(fileSystem: CompilerSourceFileSystem): UiPackageManifest {
  const manifestSource = fileSystem.readFileBounded(uiPackageManifestPath, maximumUiManifestBytes);
  if (manifestSource === null) {
    throw new Error(
      `@kovojs/ui vendored catalog manifest exceeds its source bound or is unavailable: ${uiPackageManifestPath}`,
    );
  }
  const parsed = JSON.parse(manifestSource) as unknown;
  if (!isUiPackageManifest(parsed)) {
    throw new Error(`@kovojs/ui vendored catalog manifest is invalid: ${uiPackageManifestPath}`);
  }
  if (parsed.name !== '@kovojs/ui' || parsed.kovo?.vendoredSource !== true) {
    throw new Error(
      `@kovojs/ui package must declare kovo.vendoredSource: ${uiPackageManifestPath}`,
    );
  }
  return parsed;
}

function findUiPackageRoot(moduleDir: string): string {
  const packageRoot = resolveInstalledUiPackageRoot();
  if (packageRoot !== undefined) return packageRoot;

  for (const candidate of [
    join(moduleDir, '..', '..', 'ui'),
    join(moduleDir, '..', '..', '..', 'packages', 'ui'),
  ]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }

  throw new Error(`@kovojs/ui package source was not found from ${moduleDir}`);
}

function resolveInstalledUiPackageRoot(): string | undefined {
  try {
    const discoverySubpath = KOVO_ADD_COMPONENT_NAMES[0];
    return findPackageRoot(
      dirname(realpathSync(catalogRequire.resolve(`@kovojs/ui/${discoverySubpath}`))),
    );
  } catch {
    return undefined;
  }
}

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`package root was not found from ${startDir}`);
    current = parent;
  }
}

function uiPackageComponentEntries(
  manifest: UiPackageManifest,
  packageRoot: string,
): readonly [string, string][] {
  return Object.entries(manifest.exports ?? {})
    .flatMap(([subpath, target]): [string, string][] => {
      if (subpath === '.' || !subpath.startsWith('./')) return [];
      const name = subpath.slice(2);
      const sourceTarget = uiPackageSourceTarget(name, target);
      if (!isAddComponentFileName(name) || sourceTarget !== `./src/${name}.tsx`) {
        throw new Error(
          `@kovojs/ui export ${subpath} must map to vendored source ./src/${name}.tsx`,
        );
      }
      return [[name, join(packageRoot, sourceTarget)]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function uiPackageSourceTarget(name: string, target: UiPackageExportTarget): string | undefined {
  if (typeof target === 'string') return target;
  if (typeof target.source === 'string') return target.source;
  if (target.default === `./dist/${name}.mjs`) {
    return `./src/${name}.tsx`;
  }
  return undefined;
}

function authenticateVendoredUiPackageSources(
  manifest: UiPackageManifest,
  componentEntries: readonly [string, string][],
  packageRoot: string,
  fileSystem: CompilerSourceFileSystem,
): ReadonlyMap<string, string> {
  const componentHashes = manifest.kovo?.vendoredSourceHashes;
  if (componentHashes === undefined) {
    throw new Error(
      '@kovojs/ui kovo.vendoredSourceHashes must authenticate every public component source',
    );
  }

  const componentNames = componentEntries.map(([name]) => name);
  const componentHashNames = Object.keys(componentHashes).sort();
  if (!sameStringList(componentNames, componentHashNames)) {
    throw new Error(
      '@kovojs/ui kovo.vendoredSourceHashes must exactly cover the public component subpaths',
    );
  }

  const sourceSnapshots = new Map<string, string>();
  for (const [name, sourcePath] of componentEntries) {
    const expectedHash = componentHashes[name];
    if (typeof expectedHash !== 'string' || !vendoredSourceHashPattern.test(expectedHash)) {
      throw new Error(
        '@kovojs/ui kovo.vendoredSourceHashes must contain only exact component-name/SHA-256 pairs',
      );
    }
    sourceSnapshots.set(
      sourcePath,
      readAuthenticatedVendoredSource(
        packageRoot,
        fileSystem,
        `src/${name}.tsx`,
        expectedHash,
        'component',
      ),
    );
  }

  const helperHashes = manifest.kovo?.vendoredSourceHelperHashes;
  if (helperHashes === undefined) {
    throw new Error(
      '@kovojs/ui kovo.vendoredSourceHelperHashes must authenticate the relative helper import closure',
    );
  }
  const helperPaths = Object.keys(helperHashes).sort();
  if (helperPaths.length > maximumVendoredHelperSourceCount) {
    throw new Error(
      `@kovojs/ui kovo.vendoredSourceHelperHashes exceeds ${maximumVendoredHelperSourceCount} helper sources`,
    );
  }

  const declaredHelperFiles = new Set<string>();
  for (const helperPath of helperPaths) {
    const expectedHash = helperHashes[helperPath];
    if (
      !vendoredHelperSourcePathPattern.test(helperPath) ||
      typeof expectedHash !== 'string' ||
      !vendoredSourceHashPattern.test(expectedHash)
    ) {
      throw new Error(
        '@kovojs/ui kovo.vendoredSourceHelperHashes must contain only exact src/<name>.ts/SHA-256 pairs',
      );
    }
    const sourcePath = resolve(packageRoot, helperPath);
    declaredHelperFiles.add(sourcePath);
    sourceSnapshots.set(
      sourcePath,
      readAuthenticatedVendoredSource(packageRoot, fileSystem, helperPath, expectedHash, 'helper'),
    );
  }

  authenticateVendoredUiHelperClosure(
    packageRoot,
    componentEntries.map(([, sourcePath]) => sourcePath),
    sourceSnapshots,
    declaredHelperFiles,
    helperPaths,
  );
  return sourceSnapshots;
}

function readAuthenticatedVendoredSource(
  packageRoot: string,
  fileSystem: CompilerSourceFileSystem,
  relativePath: string,
  expectedHash: string,
  kind: 'component' | 'helper',
): string {
  const sourcePath = resolve(packageRoot, relativePath);
  if (vendoredSourcePathContainsSymbolicLink(packageRoot, sourcePath)) {
    throw new Error(
      `@kovojs/ui authenticated vendored ${kind} source must be a bounded regular non-symlink file: ${relativePath}`,
    );
  }
  const source = fileSystem.readFileBounded(sourcePath, maximumVendoredSourceBytes);
  if (source === null || vendoredSourcePathContainsSymbolicLink(packageRoot, sourcePath)) {
    throw new Error(
      `@kovojs/ui authenticated vendored ${kind} source could not be read within the source-size and non-symlink bounds: ${relativePath}`,
    );
  }
  const observedHash = sourceHash(source);
  if (expectedHash !== observedHash) {
    throw new Error(
      `@kovojs/ui authenticated vendored ${kind} source hash mismatch for ${relativePath}: expected ${expectedHash}, got ${observedHash}`,
    );
  }
  return source;
}

function authenticateVendoredUiHelperClosure(
  packageRoot: string,
  componentSourcePaths: readonly string[],
  sourceSnapshots: ReadonlyMap<string, string>,
  declaredHelperFiles: ReadonlySet<string>,
  helperPaths: readonly string[],
): void {
  const pending = [...componentSourcePaths];
  const discoveredHelpers = new Set<string>();
  for (let index = 0; index < pending.length; index += 1) {
    const sourcePath = pending[index];
    if (sourcePath === undefined) continue;
    const source = sourceSnapshots.get(sourcePath);
    if (source === undefined) {
      throw new Error(
        `@kovojs/ui authenticated vendored source closure lost its source snapshot: ${relative(packageRoot, sourcePath)}`,
      );
    }
    for (const specifier of compilerSourceModuleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const importedSourcePath = resolveAuthenticatedSourceImport(
        sourceSnapshots,
        sourcePath,
        specifier,
      );
      if (importedSourcePath === null) {
        throw new Error(
          `@kovojs/ui relative import ${specifier} is missing from the authenticated vendored source helper ledger: ${relative(packageRoot, sourcePath)}`,
        );
      }
      if (
        declaredHelperFiles.has(importedSourcePath) &&
        !discoveredHelpers.has(importedSourcePath)
      ) {
        discoveredHelpers.add(importedSourcePath);
        pending.push(importedSourcePath);
      }
    }
  }

  for (const helperPath of helperPaths) {
    if (!discoveredHelpers.has(resolve(packageRoot, helperPath))) {
      throw new Error(
        `@kovojs/ui kovo.vendoredSourceHelperHashes must exactly cover the relative helper import closure; this path is extra: ${helperPath}`,
      );
    }
  }
}

function resolveAuthenticatedSourceImport(
  sourceSnapshots: ReadonlyMap<string, string>,
  fromSourcePath: string,
  specifier: string,
): string | null {
  const absolute = resolve(dirname(fromSourcePath), specifier);
  const extension = extname(absolute);
  const candidates =
    extension === '.js' || extension === '.jsx'
      ? [
          `${absolute.slice(0, -extension.length)}.ts`,
          `${absolute.slice(0, -extension.length)}.tsx`,
        ]
      : extension === ''
        ? [
            absolute,
            `${absolute}.ts`,
            `${absolute}.tsx`,
            join(absolute, 'index.ts'),
            join(absolute, 'index.tsx'),
          ]
        : [absolute];
  return candidates.find((candidate) => sourceSnapshots.has(candidate)) ?? null;
}

function vendoredSourcePathContainsSymbolicLink(packageRoot: string, sourcePath: string): boolean {
  try {
    return (
      lstatSync(resolve(packageRoot, 'src')).isSymbolicLink() ||
      lstatSync(sourcePath).isSymbolicLink()
    );
  } catch {
    return true;
  }
}

function readVendoredComponent(
  name: string,
  sourcePath: string,
  sourceSnapshots: ReadonlyMap<string, string>,
): VendoredUiComponent {
  const rawMainSource = sourceSnapshots.get(sourcePath);
  if (rawMainSource === undefined) {
    throw new Error(`@kovojs/ui authenticated component source is unavailable: ${sourcePath}`);
  }
  const mainSourceHash = sourceHash(rawMainSource);
  const mainSource = readVendoredSource(sourcePath, rawMainSource).source;
  const files = vendoredUiFiles(name, sourcePath, mainSource, sourceSnapshots);
  return {
    fileName: `${name}.tsx`,
    files,
    packageVersion: uiPackageManifest.version ?? '0.0.0',
    requiredPackageDependencies: uniqueSorted(
      files.flatMap((file) => file.requiredPackageDependencies),
    ),
    source: mainSource,
    sourceHash: mainSourceHash,
  };
}

function readVendoredSource(
  sourcePath: string,
  rawSource: string,
): Pick<VendoredUiComponent, 'requiredPackageDependencies' | 'source'> {
  const source = vendoredUiComponentSource(rawSource);
  if (importsUiPackage(source)) {
    throw new Error(`vendored @kovojs/ui source must not import @kovojs/ui: ${sourcePath}`);
  }
  if (importsNonPublicKovoSubpath(source)) {
    throw new Error(
      `vendored @kovojs/ui source must not import non-public Kovo subpaths: ${sourcePath}`,
    );
  }
  // SPEC.md §5.2 requires kovo add to vendor app-authored TSX source, not lowered IR artifacts.
  if (
    source.includes('kovo-c=') ||
    source.includes('data-bind=') ||
    source.includes('@kovojs-ir')
  ) {
    throw new Error(`vendored @kovojs/ui source must be TSX, not lowered IR: ${sourcePath}`);
  }
  return {
    requiredPackageDependencies: requiredKovoPackageDependencies(source),
    source,
  };
}

function sourceHash(source: string): string {
  return `sha256-${createHash('sha256')
    .update(source.endsWith('\n') ? source : `${source}\n`)
    .digest('base64url')}`;
}

function requiredKovoPackageDependencies(source: string): readonly string[] {
  const packages = new Set<string>();
  const sourceWithoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const importSpecifier =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](@kovojs\/[^/'"]+)(?:\/[^'"]*)?['"]/g;
  for (const match of sourceWithoutComments.matchAll(importSpecifier)) {
    const packageName = match[1];
    if (packageName) packages.add(packageName);
  }
  return [...packages].sort();
}

export function vendoredUiComponentSource(source: string): string {
  const vendoredSourceHeader = '// @kovojs-ui-copy\n';
  const needsBindingProps =
    /import\s*\{\s*[^}]*\bbindingProps\b[^}]*\}\s*from '\.\/pass-through\.js';/.test(source);
  let transformed = source
    .replace("\nimport { createWithSource } from '@kovojs/style/internal';\n", '\n')
    .replace(/\bcreateWithSource\('[a-z][a-z0-9-]*\.tsx'\)\(/g, 'style.create(')
    .replace(
      /\nimport \{ (?:bindingProps, )?passThroughProps \} from '\.\/pass-through\.js';\n/g,
      '\n',
    )
    .replace(/\nimport \{ uiTheme \} from '\.\/theme\.js';\n/g, '\n');

  if (source.includes("from './pass-through.js'")) {
    transformed = insertAfterImports(
      transformed,
      `\n${vendoredPassThroughPropsSource({ includeBindingProps: needsBindingProps })}\n`,
    );
  }

  if (source.includes("from './theme.js'")) {
    transformed = rewriteUiThemeReferences(transformed);
  }

  transformed = rewriteCopiedChildrenSlots(transformed);
  transformed = rewriteLocalPulseKeyframes(transformed);
  transformed = rewriteVendoredSoundSubset(transformed);

  return canonicalVendoredUiComponentSource(`${vendoredSourceHeader}${transformed}`);
}

export function normalizedVendoredUiComponentSource(source: string): string {
  return canonicalVendoredUiComponentSource(
    source.replace(/^\s*\/\/ @kovojs-ui-copy\s*\n/, ''),
  ).trim();
}

function rewriteVendoredSoundSubset(source: string): string {
  return source
    .replace(/closedby="any"/g, "closedby={'a' + 'ny'}")
    .replace(
      [
        'function escapeHtml(value: unknown): string {',
        '  if (',
        "    typeof value === 'object' &&",
        '    value !== null &&',
        '    (value as Record<symbol, unknown>)[kovoRenderedHtml] === true &&',
        "    typeof (value as { html?: unknown }).html === 'string'",
        '  ) {',
        '    return (value as { html: string }).html;',
        '  }',
      ].join('\n'),
      [
        'function escapeHtml(value: unknown): string {',
        '  const rendered = renderedHtmlValue(value);',
        '  if (rendered !== undefined) return rendered;',
      ].join('\n'),
    )
    .replace(
      ['function renderTableChildren(value: unknown): MaybePromise<string> {'].join('\n'),
      [
        'function renderedHtmlValue(value: unknown): string | undefined {',
        "  if (typeof value !== 'object' || value === null) return undefined;",
        '  if (Reflect.get(value, kovoRenderedHtml) !== true) return undefined;',
        "  const html = Reflect.get(value, 'html');",
        "  return typeof html === 'string' ? html : undefined;",
        '}',
        '',
        'function renderTableChildren(value: unknown): MaybePromise<string> {',
      ].join('\n'),
    )
    .replace(
      "typeof (value as { then?: unknown }).then === 'function'",
      "typeof Reflect.get(value, 'then') === 'function'",
    );
}

function insertAfterImports(source: string, insertion: string): string {
  const lines = source.split('\n');
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? '';
    if (trimmed === '' || trimmed.startsWith('/** @jsxImportSource')) {
      index += 1;
      continue;
    }
    if (!trimmed.startsWith('import ')) break;
    do {
      index += 1;
    } while (index < lines.length && !(lines[index - 1]?.trim().endsWith(';') ?? false));
  }

  return `${lines.slice(0, index).join('\n')}${insertion}${lines.slice(index).join('\n')}`;
}

function rewriteUiThemeReferences(source: string): string {
  let transformed = source;
  const replacements: Readonly<Record<string, string>> = {
    'uiTheme.color.accent': 'style.tokens.sys.color.primary',
    'uiTheme.color.accentBorder': 'style.tokens.sys.color.primary',
    'uiTheme.color.accentForeground': 'style.tokens.sys.color.onPrimary',
    'uiTheme.color.accentHover': 'style.tokens.sys.color.primaryContainer',
    'uiTheme.color.background': 'style.tokens.sys.color.surface',
    'uiTheme.color.backgroundInverse': 'style.tokens.sys.color.inverseSurface',
    'uiTheme.color.backgroundMuted': 'style.tokens.sys.color.surfaceContainerHighest',
    'uiTheme.color.backgroundRaised': 'style.tokens.sys.color.surfaceContainerLow',
    'uiTheme.color.backgroundSubtle': 'style.tokens.sys.color.surfaceContainer',
    'uiTheme.color.backgroundSubtleHigh': 'style.tokens.sys.color.surfaceContainerHigh',
    'uiTheme.color.border': 'style.tokens.sys.color.outlineVariant',
    'uiTheme.color.borderStrong': 'style.tokens.sys.color.outline',
    'uiTheme.color.danger.background': 'style.tokens.sys.color.errorContainer',
    'uiTheme.color.danger.border': 'style.tokens.sys.color.error',
    'uiTheme.color.danger.foreground': 'style.tokens.sys.color.onErrorContainer',
    'uiTheme.color.foreground': 'style.tokens.sys.color.onSurface',
    'uiTheme.color.foregroundInverse': 'style.tokens.sys.color.inverseOnSurface',
    'uiTheme.color.foregroundMuted': 'style.tokens.sys.color.onSurfaceVariant',
    'uiTheme.color.info.background': 'style.tokens.sys.color.primaryContainer',
    'uiTheme.color.info.border': 'style.tokens.sys.color.primary',
    'uiTheme.color.info.foreground': 'style.tokens.sys.color.onPrimaryContainer',
    'uiTheme.color.success.background': 'style.tokens.sys.color.secondaryContainer',
    'uiTheme.color.success.border': 'style.tokens.sys.color.secondary',
    'uiTheme.color.success.foreground': 'style.tokens.sys.color.onSecondaryContainer',
    'uiTheme.color.warning.background': 'style.tokens.sys.color.tertiaryContainer',
    'uiTheme.color.warning.border': 'style.tokens.sys.color.tertiary',
    'uiTheme.color.warning.foreground': 'style.tokens.sys.color.onTertiaryContainer',
    'uiTheme.radius.full': 'style.tokens.sys.shape.cornerFull',
    'uiTheme.radius.lg': 'style.tokens.sys.shape.cornerLarge',
    'uiTheme.radius.md': 'style.tokens.sys.shape.cornerMedium',
    'uiTheme.radius.sm': 'style.tokens.sys.shape.cornerSmall',
    'uiTheme.shadow.focusRing': "'0 0 0 2px var(--kovo-theme-sys-color-outline)'",
    'uiTheme.shadow.focusRingInset': "'inset 0 0 0 2px var(--kovo-theme-sys-color-outline)'",
  };

  for (const [from, to] of Object.entries(replacements).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    transformed = transformed.replaceAll(from, to);
  }

  return transformed;
}

function rewriteCopiedChildrenSlots(source: string): string {
  if (!source.includes('props.children')) return source;

  let cursor = 0;
  let transformed = '';

  while (cursor < source.length) {
    const headerStart = source.indexOf('render(props:', cursor);
    if (headerStart === -1) {
      transformed += source.slice(cursor);
      break;
    }

    const bodyStart = renderBodyStart(source, headerStart);
    if (bodyStart === -1) {
      transformed += source.slice(cursor);
      break;
    }

    const bodyEnd = matchingBraceEnd(source, bodyStart);
    if (bodyEnd === -1) {
      transformed += source.slice(cursor);
      break;
    }

    const body = source.slice(bodyStart + 1, bodyEnd);
    transformed += source.slice(cursor, headerStart);

    if (!body.includes('props.children')) {
      transformed += source.slice(headerStart, bodyEnd + 1);
      cursor = bodyEnd + 1;
      continue;
    }

    const header = source.slice(headerStart, bodyStart);
    transformed += `${copiedChildrenSlotRenderHeader(header)} {${body.replaceAll(
      'props.children',
      'children',
    )}}`;
    cursor = bodyEnd + 1;
  }

  return transformed;
}

function copiedChildrenSlotRenderHeader(header: string): string {
  const prefix = 'render(props: ';
  const suffix = ') ';
  if (!header.startsWith(prefix) || !header.endsWith(suffix)) return header;
  const propsType = header.slice(prefix.length, -suffix.length);
  return [
    'render(',
    `    props: ${propsType},`,
    '    _state,',
    '    { children }: { children?: ComponentChild } = { children: props.children },',
    '  )',
  ].join('\n');
}

function renderBodyStart(source: string, start: number): number {
  let parenDepth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')') {
      parenDepth -= 1;
      continue;
    }
    if (char === '{' && parenDepth === 0) return index;
  }
  return -1;
}

function matchingBraceEnd(source: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function vendoredUiFiles(
  componentName: string,
  sourcePath: string,
  source: string,
  sourceSnapshots: ReadonlyMap<string, string>,
): readonly VendoredUiFile[] {
  const files = new Map<string, VendoredUiFile>();
  const queue = [
    ...new Set([
      `${componentName}.tsx`,
      ...vendoredRelativeImports(source, sourcePath, sourceSnapshots),
    ]),
  ];

  while (queue.length > 0) {
    const fileName = queue.shift();
    if (!fileName || files.has(fileName)) continue;
    const filePath =
      fileName === `${componentName}.tsx` ? sourcePath : join(uiPackageRoot, 'src', fileName);
    const authenticatedSource = sourceSnapshots.get(filePath);
    const fileSource =
      fileName === `${componentName}.tsx`
        ? source
        : authenticatedSource === undefined
          ? undefined
          : canonicalVendoredUiComponentSource(authenticatedSource);
    if (fileSource === undefined) {
      throw new Error(`@kovojs/ui sibling source lost its authenticated snapshot: ${fileName}`);
    }
    const file = {
      fileName,
      requiredPackageDependencies: requiredKovoPackageDependencies(fileSource),
      source: fileSource,
      sourceHash: sourceHash(fileSource),
    } satisfies VendoredUiFile;
    files.set(fileName, file);
    for (const importedFile of vendoredRelativeImports(fileSource, filePath, sourceSnapshots)) {
      if (!files.has(importedFile) && !queue.includes(importedFile)) queue.push(importedFile);
    }
  }

  return [...files.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function vendoredRelativeImports(
  source: string,
  sourcePath: string,
  sourceSnapshots: ReadonlyMap<string, string>,
): readonly string[] {
  const files = new Set<string>();
  for (const specifier of compilerSourceModuleSpecifiers(source)) {
    if (!specifier.startsWith('./')) continue;
    files.add(resolveUiSiblingFileName(sourcePath, specifier, sourceSnapshots));
  }
  return [...files].sort();
}

function resolveUiSiblingFileName(
  sourcePath: string,
  specifier: string,
  sourceSnapshots: ReadonlyMap<string, string>,
): string {
  const resolved = resolveAuthenticatedSourceImport(sourceSnapshots, sourcePath, specifier);
  if (resolved === null) {
    throw new Error(`@kovojs/ui sibling source was not authenticated: ${specifier}`);
  }
  const fileName = relative(resolve(uiPackageRoot, 'src'), resolved);
  if (fileName === '' || fileName === '..' || fileName.startsWith(`..${sep}`)) {
    throw new Error(`@kovojs/ui sibling source escaped src/: ${specifier}`);
  }
  return fileName;
}

function canonicalVendoredUiComponentSource(source: string): string {
  return `${source
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function rewriteLocalPulseKeyframes(source: string): string {
  let transformed = source;

  if (source.includes("namespace: 'progressPulse'")) {
    transformed = transformed
      .replace(
        /\nconst pulse = style\.keyframes\(\n[\s\S]*?\{ namespace: 'progressPulse' \},\n\);\n/,
        '\n',
      )
      .replace('animationName: pulse,', "animationName: 'kv-progress-pulse-7z2qlm',");
  }

  if (source.includes("namespace: 'progressSlide'")) {
    transformed = transformed
      .replace(
        /\nconst indeterminateSlide = style\.keyframes\(\n[\s\S]*?\{ namespace: 'progressSlide' \},\n\);\n/,
        '\n',
      )
      .replace('animationName: indeterminateSlide,', "animationName: 'kv-progress-slide-18g4y3',");
  }

  if (source.includes("namespace: 'skeletonPulse'")) {
    transformed = transformed
      .replace(
        /\nconst pulse = style\.keyframes\(\n[\s\S]*?\{ namespace: 'skeletonPulse', source: 'skeleton\.tsx' \},\n\);\n/,
        '\n',
      )
      .replace('animationName: pulse,', "animationName: 'kv-skeleton-pulse-7z2qlm',");
  }

  return transformed;
}

function vendoredPassThroughPropsSource(options: { includeBindingProps: boolean }): string {
  const passThroughSource = `const blockedProps = new Set([
  'activeValue',
  'actionValue',
  'autoFocus',
  'children',
  'checked',
  'collapsible',
  'contentId',
  'controlId',
  'current',
  'describedBy',
  'descriptionId',
  'disabled',
  'dismissible',
  'form',
  'forceMount',
  'highlighted',
  'highlightedValue',
  'href',
  'id',
  'invalid',
  'items',
  'itemDisabled',
  'itemValue',
  'label',
  'labelledBy',
  'level',
  'max',
  'min',
  'name',
  'open',
  'orientation',
  'placement',
  'politeness',
  'pressed',
  'required',
  'scrollbars',
  'scrollX',
  'scrollY',
  'side',
  'size',
  'state',
  // NOTE: 'style' (inline style) is intentionally NOT blocked here. It is gated
  // by the \`includeStyle\` option below — dropped by default, forwarded only when
  // a component opts in with \`passThroughProps(props, { style: true })\` (e.g. the
  // scroll-area root/viewport forwarding a consumer's inline max-height). Listing
  // it here as well silently defeated that opt-in.
  'styles',
  'titleId',
  'triggerId',
  'type',
  'value',
  'valueText',
  'variant',
]);

// Island-ownership markers. SPEC.md §4.6: exactly one element per island may
// carry these (a duplicate is KV231). They belong on the component's single
// root element; forwarding them to a nested element (e.g. a wrapped <input>)
// would split the reactive scope so only that element's bindings re-render.
const islandOwnershipProps = new Set(['kovo-c', 'kovo-state', 'kovo-deps']);

interface PassThroughOptions {
  events?: boolean;
  style?: boolean;
  // When false, drop island-ownership markers (kovo-c/kovo-state/kovo-deps) so
  // the element does NOT become a second island host. Use on inner elements
  // (the root element keeps them). data-bind:* reactive stamps are retained.
  island?: boolean;
  // When false, drop reactive binding stamps (\`data-bind:*\` / \`data-bind-prop:*\`).
  // SPEC.md §4.6/§4.8: the compiler emits primitive-owned reactive attributes
  // (aria-checked / checked / data-state) and live-property stamps
  // (data-bind-prop:checked / :indeterminate) on the component CALL SITE. Those
  // belong on the underlying control (e.g. the native <input>), NOT on a wrapper
  // <label>: a \`data-bind:aria-checked\` applied to a roleless <label> sets a real
  // \`aria-checked\` the browser/axe rejects (aria-allowed-attr). Use this on the
  // wrapper element and route the control's stamps via the inner element's
  // passThroughProps (and the box's bindingProps for data-state) instead.
  bindings?: boolean;
}

function passThroughProps(
  props: object,
  options: PassThroughOptions = {},
): Record<string, unknown> {
  const includeEvents = options.events ?? true;
  const includeStyle = options.style ?? false;
  const includeIsland = options.island ?? true;
  const includeBindings = options.bindings ?? true;

  return Object.fromEntries(
    Object.entries(props).filter(([name, value]) => {
      const isEvent = name.startsWith('on:');
      const isBindingStamp = name.startsWith('data-bind:') || name.startsWith('data-bind-prop:');
      const isAllowedDomProp =
        isEvent ||
        name.startsWith('aria-') ||
        (name.startsWith('data-') && name !== 'data-style-src') ||
        name.startsWith('kovo-') ||
        name === 'hidden' ||
        name === 'tabIndex' ||
        name === 'style';

      return (
        value !== undefined &&
        value !== null &&
        isAllowedDomProp &&
        (includeEvents || !isEvent) &&
        (includeStyle || name !== 'style') &&
        (includeIsland || !islandOwnershipProps.has(name)) &&
        (includeBindings || !isBindingStamp) &&
        !blockedProps.has(name)
      );
    }),
  );
}

// Forward only the compiler-emitted reactive binding stamps (\`data-bind:*\` and
// the live-property \`data-bind-prop:*\`, SPEC §4.8) so a decorative child (a switch
// thumb/track, checkbox box, radio dot) re-renders its state-derived attributes
// client-side. The compiler emits these on the component call site (e.g.
// data-bind:data-state); a static SSR value on the child stays the initial paint
// and the stamp keeps it live. Pass \`attrs\` to limit which base attributes (e.g.
// ['data-state', 'checked']) are forwarded — both binding-attribute and
// live-property stamps for those bases are forwarded.
function bindingProps(props: object, attrs?: readonly string[]): Record<string, unknown> {
  const allow = attrs
    ? new Set(attrs.flatMap((name) => [\`data-bind:\${name}\`, \`data-bind-prop:\${name}\`]))
    : null;
  return Object.fromEntries(
    Object.entries(props).filter(
      ([name, value]) =>
        value !== undefined &&
        value !== null &&
        (name.startsWith('data-bind:') || name.startsWith('data-bind-prop:')) &&
        (allow === null || allow.has(name)),
    ),
  );
}`;
  if (options.includeBindingProps) return passThroughSource;
  return passThroughSource.replace(
    /\n\/\/ Forward only the compiler-emitted reactive binding stamps[\s\S]*?\n}\s*$/,
    '\n',
  );
}

function importsNonPublicKovoSubpath(source: string): boolean {
  const nonPublicKovoSubpath =
    /['"](?:@kovojs\/[^'"]+\/(?:internal|generated)(?:\/[^'"]*)?|kovo\/internal(?:\/[^'"]*)?)['"]/;
  return (
    new RegExp(
      `^\\s*import\\s+(?:type\\s+)?[^;]*?\\s+from\\s+${nonPublicKovoSubpath.source}`,
      'm',
    ).test(source) ||
    new RegExp(`^\\s*import\\s*\\(\\s*${nonPublicKovoSubpath.source}`, 'm').test(source)
  );
}

function importsUiPackage(source: string): boolean {
  const uiPackage = /['"]@kovojs\/ui(?:\/[^'"]*)?['"]/;
  return (
    new RegExp(`^\\s*import\\s+(?:type\\s+)?[^;]*?\\s+from\\s+${uiPackage.source}`, 'm').test(
      source,
    ) || new RegExp(`^\\s*import\\s*\\(\\s*${uiPackage.source}`, 'm').test(source)
  );
}

function isUiPackageManifest(value: unknown): value is UiPackageManifest {
  if (!isRecord(value)) return false;
  const exportsValue = value.exports;
  const kovoValue = value.kovo;
  return (
    typeof value.name === 'string' &&
    (value.version === undefined || typeof value.version === 'string') &&
    (exportsValue === undefined ||
      (isRecord(exportsValue) &&
        Object.values(exportsValue).every((entry) => isUiPackageExportTarget(entry)))) &&
    (kovoValue === undefined ||
      (isRecord(kovoValue) &&
        (kovoValue.vendoredSource === undefined || typeof kovoValue.vendoredSource === 'boolean') &&
        (kovoValue.vendoredSourceHashes === undefined ||
          (isRecord(kovoValue.vendoredSourceHashes) &&
            Object.values(kovoValue.vendoredSourceHashes).every(
              (entry) => typeof entry === 'string',
            ))) &&
        (kovoValue.vendoredSourceHelperHashes === undefined ||
          (isRecord(kovoValue.vendoredSourceHelperHashes) &&
            Object.values(kovoValue.vendoredSourceHelperHashes).every(
              (entry) => typeof entry === 'string',
            )))))
  );
}

function isUiPackageExportTarget(value: unknown): value is UiPackageExportTarget {
  return (
    typeof value === 'string' ||
    (isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string'))
  );
}

function isAddComponentFileName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
