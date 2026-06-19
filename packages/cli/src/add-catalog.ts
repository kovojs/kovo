import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VendoredUiComponent {
  fileName: `${string}.tsx`;
  source: string;
}

interface UiPackageManifest {
  exports?: Record<string, string>;
  kovo?: { vendoredSource?: boolean };
  name?: string;
}

const catalogModuleDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const catalogRequire = createRequire(import.meta.url);
const uiPackageRoot = findUiPackageRoot(catalogModuleDir);
const uiPackageManifestPath = join(uiPackageRoot, 'package.json');
const uiPackageManifest = readUiPackageManifest();

export const vendoredUiComponents = Object.freeze(
  Object.fromEntries(
    uiPackageComponentEntries(uiPackageManifest).map(([name, sourcePath]) => [
      name,
      {
        fileName: `${name}.tsx`,
        source: readVendoredSource(sourcePath),
      },
    ]),
  ),
) as Readonly<Record<string, VendoredUiComponent>>;

export type AddComponentName = keyof typeof vendoredUiComponents;

export function availableAddComponents(): string {
  return Object.keys(vendoredUiComponents).sort().join(', ');
}

export function isAddComponentName(value: string): value is AddComponentName {
  return Object.hasOwn(vendoredUiComponents, value);
}

function readUiPackageManifest(): UiPackageManifest {
  const parsed = JSON.parse(readFileSync(uiPackageManifestPath, 'utf8')) as unknown;
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
    return findPackageRoot(dirname(realpathSync(catalogRequire.resolve('@kovojs/ui'))));
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

function uiPackageComponentEntries(manifest: UiPackageManifest): readonly [string, string][] {
  return Object.entries(manifest.exports ?? {})
    .flatMap(([subpath, target]): [string, string][] => {
      if (subpath === '.' || !subpath.startsWith('./')) return [];
      const name = subpath.slice(2);
      if (!isAddComponentFileName(name) || target !== `./src/${name}.tsx`) {
        throw new Error(`@kovojs/ui export ${subpath} must point at ./src/${name}.tsx`);
      }
      return [[name, join(uiPackageRoot, target)]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function readVendoredSource(sourcePath: string): string {
  const source = vendoredUiComponentSource(readFileSync(sourcePath, 'utf8'));
  if (source.includes('@kovojs/ui')) {
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
  return source.endsWith('\n') ? source : `${source}\n`;
}

export function vendoredUiComponentSource(source: string): string {
  let transformed = source
    .replace(/\nimport \{ passThroughProps \} from '\.\/pass-through\.js';\n/g, '\n')
    .replace(/\nimport \{ uiTheme \} from '\.\/theme\.js';\n/g, '\n');

  if (source.includes("from './pass-through.js'")) {
    transformed = insertAfterImports(transformed, `\n${vendoredPassThroughPropsSource()}\n`);
  }

  if (source.includes("from './theme.js'")) {
    transformed = rewriteUiThemeReferences(transformed);
  }

  transformed = rewriteLocalPulseKeyframes(transformed);

  return transformed;
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

function vendoredPassThroughPropsSource(): string {
  return `const blockedProps = new Set([
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
  'style',
  'styles',
  'titleId',
  'triggerId',
  'type',
  'value',
  'valueText',
  'variant',
]);

interface PassThroughOptions {
  events?: boolean;
  style?: boolean;
}

function passThroughProps(
  props: object,
  options: PassThroughOptions = {},
): Record<string, unknown> {
  const includeEvents = options.events ?? true;
  const includeStyle = options.style ?? false;

  return Object.fromEntries(
    Object.entries(props).filter(([name, value]) => {
      const isEvent = name.startsWith('on:');
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
        !blockedProps.has(name)
      );
    }),
  );
}`;
}

function importsNonPublicKovoSubpath(source: string): boolean {
  const nonPublicKovoSubpath =
    /['"](?:@kovojs\/[^'"]+\/(?:internal|generated)(?:\/[^'"]*)?|kovo\/internal(?:\/[^'"]*)?)['"]/;
  return new RegExp(`(?:from\\s+|import\\s*\\()${nonPublicKovoSubpath.source}`).test(source);
}

function isUiPackageManifest(value: unknown): value is UiPackageManifest {
  if (!isRecord(value)) return false;
  const exportsValue = value.exports;
  const kovoValue = value.kovo;
  return (
    typeof value.name === 'string' &&
    (exportsValue === undefined ||
      (isRecord(exportsValue) &&
        Object.values(exportsValue).every((entry) => typeof entry === 'string'))) &&
    (kovoValue === undefined ||
      (isRecord(kovoValue) &&
        (kovoValue.vendoredSource === undefined || typeof kovoValue.vendoredSource === 'boolean')))
  );
}

function isAddComponentFileName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
