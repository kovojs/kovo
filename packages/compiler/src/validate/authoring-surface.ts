import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { compilerIrHeader, cssIrHeader } from '../ir.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

interface StringRender {
  firstHtmlTagName?: string;
  length: number;
  source: string;
  start: number;
}

export function validateAuthoringSurface(
  options: CompileComponentOptions,
  model: ComponentModuleModel | null = null,
): CompilerDiagnostic[] {
  if ((options.sourceProvenance ?? 'app') !== 'app') return [];

  if (isCompilerIrArtifact(options.source)) {
    return [compilerIrDiagnostic(options)];
  }

  const renders = model ? stringRendersFromModel(model) : [];

  return [
    ...(model?.moduleSpecifiers ?? [])
      .filter((specifier) => isNonPublicKovoSpecifier(specifier.specifier))
      .map((specifier) =>
        nonPublicKovoImportDiagnostic({
          fileName: options.fileName,
          length: specifier.end - specifier.start,
          source: options.source,
          specifier: specifier.specifier,
          start: specifier.start,
        }),
      ),
    ...(model?.moduleSpecifiers ?? [])
      .filter((specifier) => isAppLocalGeneratedSpecifier(specifier.specifier))
      .map((specifier) =>
        appLocalGeneratedImportDiagnostic({
          fileName: options.fileName,
          length: specifier.end - specifier.start,
          source: options.source,
          specifier: specifier.specifier,
          start: specifier.start,
        }),
      ),
    ...renderDiagnostics(options.fileName, options.source, renders),
  ];
}

export function isNonPublicKovoSpecifier(specifier: string): boolean {
  return /^@kovojs\/[^/]+\/(?:internal|generated)(?:\/|$)/.test(specifier);
}

export function isAppLocalGeneratedSpecifier(specifier: string): boolean {
  return /^\.{1,2}\/(?:.*\/)?generated\//.test(specifier);
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
    help: [
      `Blocked reason: app source imports non-public Kovo subpath \`${specifier}\`.`,
      'Fixes: import Kovo packages through documented public entrypoints; generated ABI subpaths are reserved for compiler-emitted modules.',
      'SPEC.md §5.2: app-authored source may import Kovo packages only through documented public entrypoints.',
    ].join('\n'),
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
    help: [
      `Blocked reason: app source imports app-local generated artifact \`${specifier}\`.`,
      'Fixes: import the authored component/module; generated route/runtime artifacts are compiler-owned.',
      'SPEC.md §5.2 and §9.5: app-authored source does not wire generated route IR or live-target registries by hand.',
    ].join('\n'),
    message: 'App source imports an app-local generated artifact; import the authored source instead.',
  };
}

function compilerIrDiagnostic(options: CompileComponentOptions): CompilerDiagnostic {
  return kv235Diagnostic({
    fileName: options.fileName,
    source: options.source,
    start: 0,
    length: options.source.startsWith(compilerIrHeader)
      ? compilerIrHeader.length
      : cssIrHeader.length,
  });
}

function renderDiagnostics(
  fileName: string,
  source: string,
  renders: readonly StringRender[],
): CompilerDiagnostic[] {
  return renders.map((render) =>
    kv235Diagnostic({
      fileName,
      source,
      start: render.start,
      length: render.length,
      ...optionalTagName(render.firstHtmlTagName ?? null),
    }),
  );
}

export function isCompilerIrArtifact(source: string): boolean {
  return source.startsWith(compilerIrHeader) || source.startsWith(cssIrHeader);
}

function stringRendersFromModel(model: ComponentModuleModel): StringRender[] {
  return [
    ...model.components.flatMap((component) => component.stringRenderReturns ?? []),
    ...model.renderSourceReturns,
  ].map((render) => ({
    ...(render.firstHtmlTagName ? { firstHtmlTagName: render.firstHtmlTagName } : {}),
    length: render.end - render.start,
    source: render.source,
    start: render.start,
  }));
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
    help: [diagnosticDefinitions.KV235.help, tsxDirection].join('\n'),
  };
}

function optionalTagName(tagName: string | null): { tagName: string } | {} {
  return tagName ? { tagName } : {};
}
