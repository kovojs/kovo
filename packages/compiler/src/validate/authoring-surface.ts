import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { isCompilerOwnedResidualAttribute } from '@kovojs/core/internal/semantic-attributes';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  kovoExecutableReferenceAttributeKind,
  type KovoExecutableReferenceAttributeKind,
} from '../executable-reference-attributes.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerJsonStringify,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import { compilerIrHeader, cssIrHeader } from '../ir.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxSpreadAttributeModel,
  type ObjectLiteralEntry,
  type StaticJsxWireAttributeEntry,
} from '../scan/parse.js';
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
    appendCompilerJsxRuntimeImportDiagnostics(diagnostics, options.fileName, options.source, model);
    appendAuthoredExecutableReferenceDiagnostics(
      diagnostics,
      options.fileName,
      options.source,
      model,
    );
    appendComponentIdentityAssignmentDiagnostics(
      diagnostics,
      options.fileName,
      options.source,
      model,
    );
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

    const hasCompilerJsxRuntimeImport =
      compilerArrayLength(
        model.compilerJsxRuntimeImports,
        'Authoring-surface compiler JSX-runtime imports',
      ) > 0;
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
      if (!hasCompilerJsxRuntimeImport && sourceCall.frameworkJsxRuntimeFactory !== undefined) {
        compilerArrayAppend(
          diagnostics,
          compilerJsxRuntimeCallDiagnostic({
            factory: sourceCall.frameworkJsxRuntimeFactory,
            fileName: options.fileName,
            length: sourceCall.end - sourceCall.start,
            source: options.source,
            start: sourceCall.start,
          }),
          'Authoring-surface diagnostics',
        );
      }
    }
  }

  appendRenderDiagnostics(diagnostics, options.fileName, options.source, renders);
  return diagnostics;
}

function appendCompilerJsxRuntimeImportDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  model: ComponentModuleModel,
): void {
  const imports = model.compilerJsxRuntimeImports;
  const length = compilerArrayLength(imports, 'Compiler JSX-runtime imports');
  for (let index = 0; index < length; index += 1) {
    const imported = compilerOwnDataValue(imports, index, 'Compiler JSX-runtime imports') as
      | ComponentModuleModel['compilerJsxRuntimeImports'][number]
      | undefined;
    if (!imported) {
      throw new TypeError(`Compiler JSX-runtime imports[${index}] must be dense.`);
    }
    compilerArrayAppend(
      diagnostics,
      {
        ...diagnosticFor(fileName, 'KV235', source, imported.start, imported.end - imported.start),
        help: compilerArrayJoin(
          [
            `Blocked reason: app source imports compiler-owned JSX construction ABI ${compilerJsonStringify(imported.factories)} from \`${imported.specifier}\`.`,
            'Fixes: author render output as TSX/JSX and let the configured JSX transform call the runtime after Kovo has validated the source.',
            'SPEC.md §5.2 rules 3 and 7: the JSX runtime is emitted execution ABI, not a second app-authoring surface.',
            'Escape: there is no app-authored import or call suppression for compiler JSX constructors.',
          ],
          '\n',
        ),
        message: 'App source imports the compiler-owned JSX runtime; author TSX/JSX instead.',
      },
      'Authoring-surface diagnostics',
    );
  }
}

function compilerJsxRuntimeCallDiagnostic({
  factory,
  fileName,
  length,
  source,
  start,
}: {
  factory: NonNullable<ComponentModuleModel['calls'][number]['frameworkJsxRuntimeFactory']>;
  fileName: string;
  length: number;
  source: string;
  start: number;
}): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV235', source, start, length),
    help: compilerArrayJoin(
      [
        `Blocked reason: app source calls exact framework JSX constructor \`${factory}\` through an alias or reviewed re-export.`,
        'Fixes: return TSX/JSX from the component and let Kovo lower the intrinsic element after contextual-output validation.',
        'SPEC.md §5.2 rules 3 and 7: compiler runtime constructors are execution ABI, not authorable render IR.',
        'Escape: local functions with the same name remain ordinary app code; the exact framework constructor has no suppression.',
      ],
      '\n',
    ),
    message: `App source calls compiler-owned JSX constructor ${factory}; author TSX/JSX instead.`,
  };
}

/**
 * SPEC §4.3/§5.2 rules 7 and 12: executable wire references are compiler output, not an
 * app-authoring surface. This gate deliberately runs over the original parser model: typed event
 * closures and reviewed primitive lowering have not emitted their on:* / data-bind* references
 * yet, while copied lowered strings remain directly attributable to authored source.
 */
function appendAuthoredExecutableReferenceDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  model: ComponentModuleModel,
): void {
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Authored executable-ref JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Authored executable-ref JSX elements',
    ) as (typeof elements)[number] | undefined;
    if (!element) {
      throw new TypeError(`Authored executable-ref JSX elements[${elementIndex}] must be dense.`);
    }

    const attributeLength = compilerArrayLength(
      element.attributes,
      'Authored executable-ref JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Authored executable-ref JSX attributes',
      ) as JsxAttributeModel | undefined;
      if (!attribute) {
        throw new TypeError(
          `Authored executable-ref JSX attributes[${attributeIndex}] must be dense.`,
        );
      }
      appendAuthoredExecutableReferenceDiagnosticForName(
        diagnostics,
        fileName,
        source,
        attribute.name,
        attribute.start,
        attribute.end,
        true,
      );
      if (
        compilerStringToLowerCase(attribute.name) === 'attrs' &&
        attribute.expressionObjectEntries !== undefined
      ) {
        appendAuthoredExecutableObjectEntryDiagnostics(
          diagnostics,
          fileName,
          source,
          attribute.expressionObjectEntries,
          attribute.start,
          attribute.end,
          'primitive attrs',
        );
      }
    }

    const spreadLength = compilerArrayLength(
      element.spreadAttributes,
      'Authored executable-ref JSX spreads',
    );
    for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex += 1) {
      const spread = compilerOwnDataValue(
        element.spreadAttributes,
        spreadIndex,
        'Authored executable-ref JSX spreads',
      ) as JsxSpreadAttributeModel | undefined;
      if (!spread) {
        throw new TypeError(`Authored executable-ref JSX spreads[${spreadIndex}] must be dense.`);
      }
      appendAuthoredExecutableSpreadDiagnostics(diagnostics, fileName, source, spread);
    }
  }
}

function appendAuthoredExecutableSpreadDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  spread: JsxSpreadAttributeModel,
): void {
  if (spread.objectEntries !== undefined) {
    appendAuthoredExecutableObjectEntryDiagnostics(
      diagnostics,
      fileName,
      source,
      spread.objectEntries,
      spread.start,
      spread.end,
      'static JSX spread',
    );
    return;
  }
  if (spread.staticWireAttributeEntries === undefined) return;
  const length = compilerArrayLength(
    spread.staticWireAttributeEntries,
    'Authored executable-ref static wire entries',
  );
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      spread.staticWireAttributeEntries,
      index,
      'Authored executable-ref static wire entries',
    ) as StaticJsxWireAttributeEntry | undefined;
    if (!entry) {
      throw new TypeError(`Authored executable-ref static wire entries[${index}] must be dense.`);
    }
    appendAuthoredExecutableReferenceDiagnosticForName(
      diagnostics,
      fileName,
      source,
      entry.key,
      spread.start,
      spread.end,
    );
  }
}

function appendAuthoredExecutableObjectEntryDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  entries: readonly ObjectLiteralEntry[],
  start: number,
  end: number,
  carrier: string,
): void {
  const length = compilerArrayLength(entries, `Authored executable-ref ${carrier} entries`);
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      entries,
      index,
      `Authored executable-ref ${carrier} entries`,
    ) as ObjectLiteralEntry | undefined;
    if (!entry) {
      throw new TypeError(`Authored executable-ref ${carrier} entries[${index}] must be dense.`);
    }
    appendAuthoredExecutableReferenceDiagnosticForName(
      diagnostics,
      fileName,
      source,
      entry.key,
      start,
      end,
    );
    if (compilerStringToLowerCase(entry.key) === 'attrs' && entry.objectEntries !== undefined) {
      appendAuthoredExecutableObjectEntryDiagnostics(
        diagnostics,
        fileName,
        source,
        entry.objectEntries,
        start,
        end,
        'nested primitive attrs',
      );
    }
  }
}

function appendAuthoredExecutableReferenceDiagnosticForName(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  name: string,
  start: number,
  end: number,
  hasTailoredDirectNavigationDiagnostic = false,
): void {
  // These five attributes already have a source-aware, route-specific KV235 validator with more
  // actionable help. Keep one diagnostic per authored stamp while the centralized manifest owns
  // every other residual control-plane attribute.
  if (hasTailoredDirectNavigationDiagnostic && isNavigationSegmentStamp(name)) return;
  const kind = kovoExecutableReferenceAttributeKind(name);
  if (kind === undefined && !isCompilerOwnedResidualAttribute(name)) return;
  if (kind === undefined) {
    compilerArrayAppend(
      diagnostics,
      {
        ...diagnosticFor(fileName, 'KV235', source, start, end - start),
        help: compilerArrayJoin(
          [
            `Blocked lowered selector: ${name}.`,
            'Fix: remove the raw control attribute and author the typed JSX expression, mutation/stream primitive, list expression, or public component API that owns the behavior.',
            'SPEC.md §5.2 rules 3 and 7: app-authored TSX is the input; only compiler/framework output may mint residual runtime control-plane stamps.',
          ],
          '\n',
        ),
        message: `App source hand-authors framework control-plane lowered IR; use typed TSX and let the compiler emit it. ${name}`,
      },
      'Authoring-surface diagnostics',
    );
    return;
  }
  compilerArrayAppend(
    diagnostics,
    {
      ...diagnosticFor(fileName, 'KV235', source, start, end - start),
      help: compilerArrayJoin(
        [
          authoredExecutableReferenceFix(kind),
          `Blocked lowered selector: ${name}.`,
          'SPEC.md §4.3/§5.2 rules 7 and 12: app source supplies typed closures, symbols, and values; only compiler-owned lowering may mint executable url#export wire references.',
        ],
        '\n',
      ),
      message: `App source hand-authors an executable lowered-IR reference; use typed TSX and let the compiler emit it. ${name}`,
    },
    'Authoring-surface diagnostics',
  );
}

function isNavigationSegmentStamp(name: string): boolean {
  const normalized = compilerStringToLowerCase(name);
  return (
    normalized === 'kovo-nav-components' ||
    normalized === 'kovo-nav-kind' ||
    normalized === 'kovo-nav-name' ||
    normalized === 'kovo-nav-queries' ||
    normalized === 'kovo-nav-segment'
  );
}

function authoredExecutableReferenceFix(kind: KovoExecutableReferenceAttributeKind): string {
  if (kind === 'handler') {
    return 'Fix: author a typed JSX closure or reviewed callable, such as `onClick={() => ...}`, `onIdle={() => ...}`, or `onVisible={() => ...}`.';
  }
  if (kind === 'derive') {
    return 'Fix: author the typed state/query expression in JSX and let Kovo emit the data-bind/data-bind-prop derive reference.';
  }
  if (kind === 'stream-renderer') {
    return 'Fix: remove the raw stream-renderer reference; v1 has no app-authored typed stream-renderer syntax, so streamed text remains plain text until the compiler owns such lowering.';
  }
  return 'Fix: remove the module allowlist attribute; the compiler derives the exact client-module allowlist from emitted handlers and derives.';
}

function appendComponentIdentityAssignmentDiagnostics(
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  source: string,
  model: ComponentModuleModel,
): void {
  const assignmentLength = compilerArrayLength(
    model.componentIdentityAssignments,
    'Authoring-surface component identity assignments',
  );
  const componentLength = compilerArrayLength(model.components, 'Authoring-surface components');
  for (let assignmentIndex = 0; assignmentIndex < assignmentLength; assignmentIndex += 1) {
    const assignment = compilerOwnDataValue(
      model.componentIdentityAssignments,
      assignmentIndex,
      'Authoring-surface component identity assignments',
    ) as ComponentModuleModel['componentIdentityAssignments'][number] | undefined;
    if (assignment === undefined) {
      throw new TypeError(
        `Authoring-surface component identity assignments[${assignmentIndex}] must be dense.`,
      );
    }
    let targetsComponent = false;
    for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
      const component = compilerOwnDataValue(
        model.components,
        componentIndex,
        'Authoring-surface components',
      ) as ComponentModuleModel['components'][number] | undefined;
      if (component === undefined) {
        throw new TypeError(`Authoring-surface components[${componentIndex}] must be dense.`);
      }
      if (component.localName === assignment.target) {
        targetsComponent = true;
        break;
      }
    }
    if (!targetsComponent) continue;
    compilerArrayAppend(
      diagnostics,
      {
        ...diagnosticFor(
          fileName,
          'KV235',
          source,
          assignment.start,
          assignment.end - assignment.start,
        ),
        help: compilerArrayJoin(
          [
            `Blocked reason: app source assigns compiler-owned derived identity \`${assignment.target}.name = ${compilerJsonStringify(assignment.value)}\`.`,
            'Fixes: remove the identity assignment and any copied lowered output; configure the component in TSX and let Kovo derive its registry and kovo-c identity.',
            'SPEC.md §5.2 rules 3 and 7: compiler output is proof/fixpoint material, not a second app-authoring surface.',
          ],
          '\n',
        ),
        message:
          'App source assigns a compiler-owned component identity; remove copied lowered output.',
      },
      'Authoring-surface diagnostics',
    );
  }
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
