import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { compilerIrHeader, cssIrHeader } from '../ir.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import { isCompilerEmittedSourceProvenance } from '../source-provenance.js';
import type { InternalCompileComponentOptions } from '../types.js';

interface StringRender {
  firstHtmlTagName?: string;
  length: number;
  source: string;
  start: number;
}

interface KeyFirstRegistryCall {
  length: number;
  primitive: 'mutation' | 'query';
  start: number;
}

export function validateAuthoringSurface(
  options: InternalCompileComponentOptions,
  model: ComponentModuleModel | null = null,
): CompilerDiagnostic[] {
  if (isCompilerEmittedSourceProvenance(options.sourceProvenance)) return [];

  if (isCompilerIrArtifact(options.source)) {
    return [compilerIrDiagnostic(options)];
  }

  const renders = model ? stringRendersFromModel(model) : [];
  const diagnostics: CompilerDiagnostic[] = [];

  if (model !== null) {
    const specifierLength = compilerArrayLength(
      model.moduleSpecifiers,
      'Authoring-surface module specifiers',
    );
    for (let index = 0; index < specifierLength; index += 1) {
      const specifier = compilerOwnDataValue(
        model.moduleSpecifiers,
        index,
        'Authoring-surface module specifiers',
      ) as ComponentModuleModel['moduleSpecifiers'][number] | undefined;
      if (specifier === undefined) {
        throw new TypeError(`Authoring-surface module specifiers[${index}] must be dense.`);
      }
      if (isNonPublicKovoSpecifier(specifier.specifier)) {
        compilerArrayAppend(
          diagnostics,
          nonPublicKovoImportDiagnostic({
            fileName: options.fileName,
            length: specifier.end - specifier.start,
            source: options.source,
            specifier: specifier.specifier,
            start: specifier.start,
          }),
          'Authoring-surface diagnostics',
        );
      }
      if (isAppLocalGeneratedSpecifier(specifier.specifier)) {
        compilerArrayAppend(
          diagnostics,
          appLocalGeneratedImportDiagnostic({
            fileName: options.fileName,
            length: specifier.end - specifier.start,
            source: options.source,
            specifier: specifier.specifier,
            start: specifier.start,
          }),
          'Authoring-surface diagnostics',
        );
      }
    }

    const callLength = compilerArrayLength(model.calls, 'Authoring-surface calls');
    for (let index = 0; index < callLength; index += 1) {
      const sourceCall = compilerOwnDataValue(model.calls, index, 'Authoring-surface calls') as
        | ComponentModuleModel['calls'][number]
        | undefined;
      if (sourceCall === undefined) {
        throw new TypeError(`Authoring-surface calls[${index}] must be dense.`);
      }
      const call = keyFirstRegistryCall(sourceCall);
      if (call !== null) {
        compilerArrayAppend(
          diagnostics,
          keyFirstRegistryIdentityDiagnostic({
            fileName: options.fileName,
            length: call.length,
            primitive: call.primitive,
            source: options.source,
            start: call.start,
          }),
          'Authoring-surface diagnostics',
        );
      }
    }
  }

  appendRenderDiagnostics(diagnostics, options.fileName, options.source, renders);
  return diagnostics;
}

export function isNonPublicKovoSpecifier(specifier: string): boolean {
  return (
    compilerRegExpTest(/^@kovojs\/[^/]+\/(?:internal|generated)(?:\/|$)/, specifier) ||
    compilerRegExpTest(/^kovo\/(?:internal|generated)(?:\/|$)/, specifier)
  );
}

export function isAppLocalGeneratedSpecifier(specifier: string): boolean {
  return compilerRegExpTest(/(?:^|\/)generated\//, specifier) && !isPackageSpecifier(specifier);
}

function isPackageSpecifier(specifier: string): boolean {
  return (
    !compilerStringStartsWith(specifier, '.') &&
    !compilerStringStartsWith(specifier, '/') &&
    !compilerStringStartsWith(specifier, 'src/')
  );
}

function nonPublicKovoImportDiagnostic({
  fileName,
  length,
  source,
  specifier,
  start,
}: {
  fileName: string;
  length: number;
  source: string;
  specifier: string;
  start: number;
}): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV235', source, start, length),
    help: compilerArrayJoin(
      [
        `Blocked reason: app source imports non-public Kovo subpath \`${specifier}\`.`,
        'Fixes: import Kovo packages through documented public entrypoints; generated ABI subpaths are reserved for compiler-emitted modules.',
        'SPEC.md §5.2: app-authored source may import Kovo packages only through documented public entrypoints.',
      ],
      '\n',
    ),
    message: 'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
  };
}

function appLocalGeneratedImportDiagnostic({
  fileName,
  length,
  source,
  specifier,
  start,
}: {
  fileName: string;
  length: number;
  source: string;
  specifier: string;
  start: number;
}): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV235', source, start, length),
    help: compilerArrayJoin(
      [
        `Blocked reason: app source imports app-local generated artifact \`${specifier}\`.`,
        'Fixes: import the authored component/module; generated route/runtime artifacts are compiler-owned.',
        'SPEC.md §5.2 and §9.5: app-authored source does not wire generated route IR or live-target registries by hand.',
      ],
      '\n',
    ),
    message:
      'App source imports an app-local generated artifact; import the authored source instead.',
  };
}

function keyFirstRegistryCall(
  call: ComponentModuleModel['calls'][number],
): KeyFirstRegistryCall | null {
  if (!call.exportedConstName) return null;
  if (call.name !== 'mutation' && call.name !== 'query') {
    return null;
  }
  if (typeof call.argumentStaticValues[0] !== 'string') return null;
  const span = call.argumentSpans[0] ?? { end: call.end, start: call.start };
  return {
    length: span.end - span.start,
    primitive: call.name,
    start: span.start,
  };
}

function keyFirstRegistryIdentityDiagnostic({
  fileName,
  length,
  primitive,
  source,
  start,
}: {
  fileName: string;
  length: number;
  primitive: KeyFirstRegistryCall['primitive'];
  source: string;
  start: number;
}): CompilerDiagnostic {
  const sourceForm =
    primitive === 'mutation' ? 'mutation({ input, handler })' : 'query({ load, reads })';
  return {
    ...diagnosticFor(fileName, 'KV235', source, start, length),
    help: compilerArrayJoin(
      [
        `Blocked reason: app source hard-codes a ${primitive} registry identity that the compiler can derive from the exported binding and module path.`,
        `Fixes: use \`${sourceForm}\` and let the compiler emit the source-derived registry key; keep string registry keys only in compiler-emitted/generated ABI.`,
        'SPEC.md §4.1: app-authored TSX and server modules do not write registry-name strings merely to repeat facts the compiler can derive.',
      ],
      '\n',
    ),
    message: `App source hard-codes a ${primitive} registry identity; use the source-derived object form.`,
  };
}

function compilerIrDiagnostic(options: InternalCompileComponentOptions): CompilerDiagnostic {
  return kv235Diagnostic({
    fileName: options.fileName,
    source: options.source,
    start: 0,
    length: compilerStringStartsWith(options.source, compilerIrHeader)
      ? compilerIrHeader.length
      : cssIrHeader.length,
  });
}

function appendRenderDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  renders: readonly StringRender[],
): void {
  const length = compilerArrayLength(renders, 'Authoring-surface string renders');
  for (let index = 0; index < length; index += 1) {
    const render = compilerOwnDataValue(renders, index, 'Authoring-surface string renders') as
      | StringRender
      | undefined;
    if (render === undefined) {
      throw new TypeError(`Authoring-surface string renders[${index}] must be dense.`);
    }
    compilerArrayAppend(
      diagnostics,
      kv235Diagnostic({
        fileName,
        source,
        start: render.start,
        length: render.length,
        ...optionalTagName(render.firstHtmlTagName ?? null),
      }),
      'Authoring-surface diagnostics',
    );
  }
}

export function isCompilerIrArtifact(source: string): boolean {
  return (
    compilerStringStartsWith(source, compilerIrHeader) ||
    compilerStringStartsWith(source, cssIrHeader)
  );
}

function stringRendersFromModel(model: ComponentModuleModel): StringRender[] {
  const result: StringRender[] = [];
  const componentLength = compilerArrayLength(model.components, 'Authoring-surface components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = compilerOwnDataValue(
      model.components,
      componentIndex,
      'Authoring-surface components',
    ) as ComponentModuleModel['components'][number] | undefined;
    if (component === undefined) {
      throw new TypeError(`Authoring-surface components[${componentIndex}] must be dense.`);
    }
    const renders = component.stringRenderReturns ?? [];
    appendStringRenders(result, renders, `Authoring-surface component ${componentIndex} renders`);
  }
  appendStringRenders(result, model.renderSourceReturns, 'Authoring-surface renderSource returns');
  return result;
}

function appendStringRenders(
  result: StringRender[],
  renders: readonly ComponentModuleModel['renderSourceReturns'][number][],
  label: string,
): void {
  const length = compilerArrayLength(renders, label);
  for (let index = 0; index < length; index += 1) {
    const render = compilerOwnDataValue(renders, index, label) as
      | ComponentModuleModel['renderSourceReturns'][number]
      | undefined;
    if (render === undefined) throw new TypeError(`${label}[${index}] must be dense.`);
    compilerArrayAppend(
      result,
      {
        ...(render.firstHtmlTagName ? { firstHtmlTagName: render.firstHtmlTagName } : {}),
        length: render.end - render.start,
        source: render.source,
        start: render.start,
      },
      label,
    );
  }
}

function kv235Diagnostic({
  fileName,
  length,
  source,
  start,
  tagName,
}: {
  fileName: string;
  length: number;
  source: string;
  start: number;
  tagName?: string;
}): CompilerDiagnostic {
  const tsxDirection = tagName
    ? `TSX equivalent direction: render with JSX, for example \`render: (...) => (<${tagName}>...</${tagName}>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.`
    : 'TSX equivalent direction: render with JSX and use typed expressions such as `{cart.count}` instead of data-bind strings.';

  return {
    ...diagnosticFor(fileName, 'KV235', source, start, length),
    help: compilerArrayJoin([diagnosticDefinitions.KV235.help, tsxDirection], '\n'),
  };
}

function optionalTagName(tagName: string | null): { tagName: string } | {} {
  return tagName ? { tagName } : {};
}
