import ts from 'typescript';

import type { ClientModuleImportManifestEntry } from '../../../packages/compiler/src/types.js';

export type GalleryClientModuleManifest = readonly ClientModuleImportManifestEntry[];

export interface GalleryClientModuleStub {
  readonly exports: Readonly<Record<string, unknown>>;
  readonly moduleSpecifier: string;
}

export const galleryRuntimeModuleSpecifier = '@kovojs/browser/generated';
export const galleryPrimitiveActionsGeneratedModuleSpecifier = './primitive-actions.generated.js';
export const galleryHeadlessGeneratedModuleSpecifier = '@kovojs/headless-ui/generated';
export const galleryHeadlessPrimitiveModuleSpecifier = '@kovojs/headless-ui/internal/primitive';

export function rebaseGalleryClientModuleManifest(
  manifest: GalleryClientModuleManifest,
  moduleSpecifiers: ReadonlyMap<string, string>,
): GalleryClientModuleManifest {
  return manifest.map((entry) => ({
    ...entry,
    moduleSpecifier: moduleSpecifiers.get(entry.moduleSpecifier) ?? entry.moduleSpecifier,
  }));
}

export function resolveGalleryClientModuleSpecifiers(
  source: string,
  manifest: GalleryClientModuleManifest,
  resolve: (moduleSpecifier: string) => string,
): string {
  const manifestSpecifiers = new Set(manifest.map((entry) => entry.moduleSpecifier));
  const sourceFile = ts.createSourceFile(
    'gallery-client-module.js',
    source,
    ts.ScriptTarget.Latest,
  );
  const replacements: Array<{ end: number; start: number; value: string }> = [];

  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;

    if (!manifestSpecifiers.has(moduleSpecifier.text)) {
      throw new Error(
        `Gallery client module import is missing from manifest: ${moduleSpecifier.text}`,
      );
    }

    replacements.push({
      end: moduleSpecifier.getEnd() - 1,
      start: moduleSpecifier.getStart(sourceFile) + 1,
      value: resolve(moduleSpecifier.text),
    });
  }

  return applySourceReplacements(source, replacements);
}

export function galleryPrimitiveActionsImportManifest(): GalleryClientModuleManifest {
  const primitives = [
    'accordion',
    'alert-dialog',
    'autocomplete',
    'avatar',
    'checkbox',
    'checkbox-group',
    'collapsible',
    'combobox',
    'command',
    'context-menu',
    'dialog',
    'disclosure',
    'dropdown-menu',
    'field',
    'hover-card',
    'menubar',
    'meter',
    'navigation-menu',
    'number-field',
    'otp-field',
    'popover',
    'progress',
    'radio-group',
    'scroll-area',
    'separator',
    'select',
    'slider',
    'switch',
    'tabs',
    'toast',
    'toggle',
    'toggle-group',
    'toolbar',
    'tooltip',
  ];

  return [
    { imports: [], moduleSpecifier: galleryPrimitiveActionsGeneratedModuleSpecifier },
    ...primitives.map((primitive) => ({
      imports: [],
      moduleSpecifier: `@kovojs/headless-ui/${primitive}`,
    })),
  ];
}

export function galleryPrimitiveActionsGeneratedImportManifest(): GalleryClientModuleManifest {
  return [
    { imports: [], moduleSpecifier: galleryHeadlessGeneratedModuleSpecifier },
    { imports: [], moduleSpecifier: galleryHeadlessPrimitiveModuleSpecifier },
  ];
}

export function transpileGalleryClientModuleForVm(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: {
      allowJs: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'gallery-client-module.js',
  }).outputText;
}

export function galleryRuntimeStub(): GalleryClientModuleStub {
  return {
    exports: {
      derive: (inputs: readonly string[], run: (...values: unknown[]) => unknown) => ({
        inputs,
        run,
      }),
      handler: <T>(fn: T) => fn,
      kovoStyleProperty: (_name: string, value: unknown) => {
        if (value == null || value === false) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
        return '';
      },
    },
    moduleSpecifier: galleryRuntimeModuleSpecifier,
  };
}

export function primitiveActionsStub(
  primitiveActions: Readonly<Record<string, unknown>>,
): GalleryClientModuleStub {
  return {
    exports: primitiveActions,
    moduleSpecifier: '../primitive-actions.js',
  };
}

export function createGalleryVmRequire(
  manifest: GalleryClientModuleManifest,
  stubs: readonly GalleryClientModuleStub[],
): (moduleSpecifier: string) => Readonly<Record<string, unknown>> {
  const required = new Set(manifest.map((entry) => entry.moduleSpecifier));
  const modules = new Map(stubs.map((stub) => [stub.moduleSpecifier, stub.exports]));

  return (moduleSpecifier: string) => {
    if (!required.has(moduleSpecifier)) {
      throw new Error(`Gallery VM requested undeclared client module: ${moduleSpecifier}`);
    }
    const moduleExports = modules.get(moduleSpecifier);
    if (moduleExports === undefined) {
      throw new Error(`Gallery VM missing client module stub: ${moduleSpecifier}`);
    }
    return moduleExports;
  };
}

function applySourceReplacements(
  source: string,
  replacements: readonly { end: number; start: number; value: string }[],
): string {
  let next = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
  }
  return next;
}
