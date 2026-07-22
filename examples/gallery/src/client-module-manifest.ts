import ts from 'typescript';

import type { ClientModuleImportManifestEntry } from '../../../packages/compiler/src/types.js';

export type GalleryClientModuleManifest = readonly ClientModuleImportManifestEntry[];

export interface GalleryClientModuleStub {
  readonly exports: Readonly<Record<string, unknown>>;
  readonly moduleSpecifier: string;
}

/**
 * A compiler-emitted module href and the immutable href of the exact final browser bytes after
 * gallery-owned import resolution. Rendered handler references must be rebased through this pair
 * whenever the resolver changes the emitted representation (SPEC §5.2.1).
 */
export interface GalleryClientModuleHrefRewrite {
  readonly compiledHref: string;
  readonly href: string;
}

export const galleryRuntimeModuleSpecifier = '@kovojs/browser/generated';
export const galleryPrimitiveActionsGeneratedModuleSpecifier = './primitive-actions.generated.js';
export const galleryHeadlessGeneratedModuleSpecifier = '@kovojs/headless-ui/generated';

// The gallery serves compiled demo handlers from an in-memory module registry, so its browser
// runtime shim must track the compiler-owned generated ABI (SPEC §4.3/§5.2). Keep the finite
// security-operation verifier aligned with the compiler's standalone runtime helper rather than
// weakening generated securityHandler() calls to an identity function.
export const galleryRuntimeModuleSource = `export const derive = (inputs, run) => ({ inputs, run });
export const handler = (fn) => fn;
export const securityHandler = (operations, fn) => {
  if (!Array.isArray(operations) || operations.length > 256 || typeof fn !== 'function') {
    throw new TypeError('KV449: invalid generated browser security-operation manifest.');
  }
  const doors = {
    'browser.dialog.close': 'platform-invoker',
    'browser.dialog.open': 'platform-invoker',
    'browser.dom.focus': 'compiler-dom-focus',
    'browser.event.control': 'delegated-event',
    'browser.event.read': 'delegated-event',
    'browser.form.reset': 'compiler-form',
    'browser.form.submit': 'compiler-form',
    'browser.framework.call': 'reviewed-client-export',
    'browser.state.read': 'compiler-state',
    'browser.state.write': 'compiler-state',
    'browser.timer.cancel': 'framework-timer',
    'browser.timer.schedule': 'framework-timer',
  };
  for (let index = 0; index < operations.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(operations, String(index));
    const operation = entry && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : undefined;
    if (!operation || typeof operation !== 'object') {
      throw new TypeError('KV449: invalid generated browser security operation.');
    }
    const keys = Object.keys(operation);
    if (keys.some((key) => key !== 'door' && key !== 'kind' && key !== 'target')) {
      throw new TypeError('KV449: invalid generated browser security operation.');
    }
    const kindEntry = Object.getOwnPropertyDescriptor(operation, 'kind');
    const doorEntry = Object.getOwnPropertyDescriptor(operation, 'door');
    const targetEntry = Object.getOwnPropertyDescriptor(operation, 'target');
    const kind = kindEntry && Object.prototype.hasOwnProperty.call(kindEntry, 'value') ? kindEntry.value : undefined;
    const door = doorEntry && Object.prototype.hasOwnProperty.call(doorEntry, 'value') ? doorEntry.value : undefined;
    const target = targetEntry && Object.prototype.hasOwnProperty.call(targetEntry, 'value') ? targetEntry.value : undefined;
    if (
      !kindEntry || !Object.prototype.hasOwnProperty.call(kindEntry, 'value') ||
      !doorEntry || !Object.prototype.hasOwnProperty.call(doorEntry, 'value') ||
      (targetEntry && !Object.prototype.hasOwnProperty.call(targetEntry, 'value')) ||
      doors[kind] !== door ||
      (targetEntry && typeof target !== 'string')
    ) {
      throw new TypeError('KV449: invalid generated browser security operation.');
    }
  }
  return fn;
};
export const kovoStyleProperty = (name, value) => value == null || value === false ? '' : \`\${name}: \${value}\`;
`;

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

export function rewriteGalleryClientModuleHrefs(
  source: string,
  rewrites: readonly GalleryClientModuleHrefRewrite[],
): string {
  let rewritten = source;
  for (const { compiledHref, href } of rewrites) {
    if (compiledHref === href) continue;
    rewritten = rewritten.replaceAll(compiledHref, href);
  }
  return rewritten;
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
  return [{ imports: [], moduleSpecifier: galleryHeadlessGeneratedModuleSpecifier }];
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
      securityHandler: <T>(_operations: readonly unknown[], fn: T) => fn,
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
    moduleSpecifier: galleryHeadlessGeneratedModuleSpecifier,
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
