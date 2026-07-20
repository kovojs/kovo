import type {
  BrowserPostureCspDirective,
  BrowserPostureExternalOrigin,
  BrowserPostureIsolationBlocker,
  BrowserPostureOpaqueExternalUrl,
} from '@kovojs/core/internal/security-operation-ir';
import {
  elementContextSecurityControl,
  elementHasContextSecurityControls,
} from '@kovojs/core/internal/sink-policy';

import {
  compilerAbsoluteHttpUrlOrigin,
  compilerArrayLength,
  compilerDefineOwnDataProperty,
  compilerOwnDataValue,
  compilerSetOwnDataProperty,
  compilerSnapshotDenseArray,
  compilerStringCharCodeAt,
  compilerStringIncludes,
  compilerStringLocaleCompare,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringTrim,
} from './compiler-security-intrinsics.js';
import { contextualizeCompilerDiagnostic, diagnosticFor } from './diagnostics.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import type { JsxIrAttribute, JsxIrElement } from './jsx-ir.js';
import {
  parserFactFrameworkTrustedUrlReason,
  parserFactHasFrameworkTrustedUrl,
} from './scan/parse.js';
import type { StaticJsxWireAttributeEntry } from './scan/model.js';

/** @internal Browser posture facts derived from the final effective intrinsic tree. */
export interface DerivedBrowserPostureFacts {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly externalOrigins: readonly BrowserPostureExternalOrigin[];
  readonly isolationBlockers: readonly BrowserPostureIsolationBlocker[];
  readonly opaqueExternalUrls: readonly BrowserPostureOpaqueExternalUrl[];
}

interface AssetPosition {
  readonly attribute: string;
  readonly directive: BrowserPostureCspDirective;
}

/**
 * Derive the exact browser fetch posture after spread and primitive composition lowering.
 *
 * SPEC §2/§4.8: the same effective element/attribute tuple that selects a browser request is
 * the source of CSP intent. A caller-owned expression is closed unless the exact trustedUrl
 * constructor carries a static audit reason; no spelling-based lookalike is accepted.
 *
 * @internal
 */
export function deriveBrowserPostureFacts(
  roots: readonly JsxIrElement[],
  options: { readonly fileName: string; readonly source: string },
): DerivedBrowserPostureFacts {
  const diagnostics: CompilerDiagnostic[] = [];
  const externalOrigins: BrowserPostureExternalOrigin[] = [];
  const isolationBlockers: BrowserPostureIsolationBlocker[] = [];
  const opaqueExternalUrls: BrowserPostureOpaqueExternalUrl[] = [];

  const visit = (element: JsxIrElement): void => {
    if (element.removed) return;
    const tag = element.intrinsicTagName;
    if (tag !== undefined) {
      const normalizedTag = compilerStringToLowerCase(tag);
      const positions = assetPositions(element, normalizedTag);
      const positionLength = compilerArrayLength(positions, 'Browser posture asset positions');
      for (let index = 0; index < positionLength; index += 1) {
        const position = compilerOwnDataValue(
          positions,
          index,
          'Browser posture asset positions',
        ) as AssetPosition;
        const attribute = effectiveAttribute(element, position.attribute);
        if (attribute !== undefined) {
          classifyAssetAttribute(
            element,
            attribute,
            position,
            options,
            diagnostics,
            externalOrigins,
            opaqueExternalUrls,
            isolationBlockers,
          );
        }
      }

      if (
        normalizedTag === 'link' &&
        effectiveAttribute(element, 'href') !== undefined &&
        effectiveAttribute(element, 'rel')?.value.kind === 'expression' &&
        elementContextSecurityControl(normalizedTag, 'rel') === undefined
      ) {
        append(
          diagnostics,
          browserPostureDiagnostic(
            options,
            spanFor(element),
            '<link> has a computed rel that prevents exact external asset URL classification',
          ),
        );
      }

      if (
        hasOpaqueSpread(element) &&
        possibleAssetAttributes(element, normalizedTag).length > 0 &&
        opaqueSpreadNeedsBrowserPostureDiagnostic(normalizedTag)
      ) {
        append(
          diagnostics,
          browserPostureDiagnostic(
            options,
            spanFor(element),
            `<${normalizedTag}> has an opaque spread that could introduce a computed external asset URL`,
          ),
        );
      }

      if (normalizedTag === 'iframe') {
        append(isolationBlockers, {
          fileName: options.fileName,
          kind: 'frame',
          site: 'iframe',
          span: spanFor(element),
        });
      }
      const popupAttribute = popupTargetAttribute(element, normalizedTag);
      if (popupAttribute !== undefined && popupTargetIsOpen(popupAttribute)) {
        append(isolationBlockers, {
          fileName: options.fileName,
          kind: 'popup',
          site: `${normalizedTag}[${popupAttribute.name}]`,
          span: spanForAttribute(element, popupAttribute),
        });
      }
    }

    const childLength = compilerArrayLength(element.children, 'Browser posture child elements');
    for (let index = 0; index < childLength; index += 1) {
      const child = compilerOwnDataValue(
        element.children,
        index,
        'Browser posture child elements',
      ) as (typeof element.children)[number];
      if (child.kind === 'element') visit(child);
    }
  };

  const rootLength = compilerArrayLength(roots, 'Browser posture roots');
  for (let index = 0; index < rootLength; index += 1) {
    visit(compilerOwnDataValue(roots, index, 'Browser posture roots') as JsxIrElement);
  }

  return {
    diagnostics,
    externalOrigins: sortedExternalOrigins(externalOrigins),
    isolationBlockers: sortedBlockers(isolationBlockers),
    opaqueExternalUrls: sortedOpaqueUrls(opaqueExternalUrls),
  };
}

function classifyAssetAttribute(
  element: JsxIrElement,
  attribute: JsxIrAttribute,
  position: AssetPosition,
  options: { readonly fileName: string; readonly source: string },
  diagnostics: CompilerDiagnostic[],
  externalOrigins: BrowserPostureExternalOrigin[],
  opaqueExternalUrls: BrowserPostureOpaqueExternalUrl[],
  isolationBlockers: BrowserPostureIsolationBlocker[],
): void {
  const site = `${compilerStringToLowerCase(element.intrinsicTagName ?? element.tag)}[${position.attribute}]`;
  const span = spanForAttribute(element, attribute);
  if (attribute.value.kind === 'expression') {
    if (attribute.value.trustedUrl !== true || attribute.value.trustedUrlReason === undefined) {
      if (
        elementContextSecurityControl(
          element.intrinsicTagName ?? element.tag,
          position.attribute,
        ) !== undefined
      ) {
        return;
      }
      append(
        diagnostics,
        browserPostureDiagnostic(
          options,
          span,
          `${site} contains a computed external asset URL without the exact trustedUrl(value, auditedReason) escape`,
        ),
      );
      return;
    }
    append(opaqueExternalUrls, {
      directive: position.directive,
      fileName: options.fileName,
      reason: attribute.value.trustedUrlReason,
      site,
      span,
    });
    append(isolationBlockers, {
      fileName: options.fileName,
      kind: 'opaque-resource',
      site,
      span,
    });
    return;
  }
  if (attribute.value.kind !== 'string') return;
  const value = compilerStringTrim(attribute.value.value);
  if (position.attribute === 'srcset') {
    const candidates = staticSrcsetUrls(value);
    const length = compilerArrayLength(candidates, 'Browser posture srcset candidates');
    for (let index = 0; index < length; index += 1) {
      classifyStaticAssetUrl(
        compilerOwnDataValue(candidates, index, 'Browser posture srcset candidates') as string,
        site,
        span,
        position.directive,
        options,
        diagnostics,
        externalOrigins,
        isolationBlockers,
      );
    }
    return;
  }
  classifyStaticAssetUrl(
    value,
    site,
    span,
    position.directive,
    options,
    diagnostics,
    externalOrigins,
    isolationBlockers,
  );
}

function classifyStaticAssetUrl(
  value: string,
  site: string,
  span: { readonly end: number; readonly start: number },
  directive: BrowserPostureCspDirective,
  options: { readonly fileName: string; readonly source: string },
  diagnostics: CompilerDiagnostic[],
  externalOrigins: BrowserPostureExternalOrigin[],
  isolationBlockers: BrowserPostureIsolationBlocker[],
): void {
  if (value === '' || isLocalAssetUrl(value)) return;
  const origin = compilerAbsoluteHttpUrlOrigin(value);
  if (origin === undefined) {
    append(
      diagnostics,
      browserPostureDiagnostic(
        options,
        span,
        `${site} has an external asset URL whose canonical HTTP(S) origin cannot be derived`,
      ),
    );
    return;
  }
  append(externalOrigins, {
    directive,
    fileName: options.fileName,
    origin,
    site,
    span,
  });
  append(isolationBlockers, {
    fileName: options.fileName,
    kind: 'external-resource',
    site,
    span,
  });
}

/** Parse only the URL token from each static HTML srcset candidate, including data-URL commas. */
function staticSrcsetUrls(value: string): string[] {
  const urls: string[] = [];
  const length = value.length;
  let index = 0;
  while (index < length) {
    while (index < length) {
      const code = compilerStringCharCodeAt(value, index);
      if (code !== 0x2c && !isAsciiSpace(code)) break;
      index += 1;
    }
    if (index >= length) break;
    const start = index;
    while (index < length && !isAsciiSpace(compilerStringCharCodeAt(value, index))) index += 1;
    let end = index;
    while (end > start && compilerStringCharCodeAt(value, end - 1) === 0x2c) end -= 1;
    if (end > start) append(urls, compilerStringSlice(value, start, end));
    if (end !== index) continue;
    while (index < length && compilerStringCharCodeAt(value, index) !== 0x2c) index += 1;
    if (index < length) index += 1;
  }
  return urls;
}

function isAsciiSpace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

function assetPositions(element: JsxIrElement, tag: string): AssetPosition[] {
  switch (tag) {
    case 'script':
      return [{ attribute: 'src', directive: 'script-src' }];
    case 'iframe':
      return [{ attribute: 'src', directive: 'frame-src' }];
    case 'img':
      return [
        { attribute: 'src', directive: 'img-src' },
        { attribute: 'srcset', directive: 'img-src' },
      ];
    case 'image':
    case 'feimage':
      return [
        { attribute: 'href', directive: 'img-src' },
        { attribute: 'xlink:href', directive: 'img-src' },
      ];
    case 'audio':
      return [{ attribute: 'src', directive: 'media-src' }];
    case 'track':
      return [{ attribute: 'src', directive: 'media-src' }];
    case 'input':
      return staticLowerAttributeValue(element, 'type') === 'image'
        ? [{ attribute: 'src', directive: 'img-src' }]
        : [];
    case 'video':
      return [
        { attribute: 'poster', directive: 'img-src' },
        { attribute: 'src', directive: 'media-src' },
      ];
    case 'source':
      return [
        { attribute: 'src', directive: 'media-src' },
        { attribute: 'srcset', directive: 'img-src' },
      ];
    case 'link':
      return linkAssetPositions(element);
    default:
      return [];
  }
}

function linkAssetPositions(element: JsxIrElement): AssetPosition[] {
  const rel = staticLowerAttributeValue(element, 'rel');
  const as = staticLowerAttributeValue(element, 'as');
  if (rel !== undefined && asciiTokenListHas(rel, 'stylesheet')) {
    return [{ attribute: 'href', directive: 'style-src' }];
  }
  if (rel !== undefined && asciiTokenListHas(rel, 'modulepreload')) {
    return [{ attribute: 'href', directive: 'script-src' }];
  }
  if (
    rel !== undefined &&
    (asciiTokenListHas(rel, 'icon') ||
      asciiTokenListHas(rel, 'apple-touch-icon') ||
      asciiTokenListHas(rel, 'mask-icon'))
  ) {
    return [{ attribute: 'href', directive: 'img-src' }];
  }
  if (rel === undefined || !asciiTokenListHas(rel, 'preload')) return [];
  switch (as) {
    case 'fetch':
      return [{ attribute: 'href', directive: 'connect-src' }];
    case 'font':
      return [{ attribute: 'href', directive: 'font-src' }];
    case 'image':
      return [{ attribute: 'href', directive: 'img-src' }];
    case 'script':
      return [{ attribute: 'href', directive: 'script-src' }];
    case 'style':
      return [{ attribute: 'href', directive: 'style-src' }];
    default:
      return [];
  }
}

function asciiTokenListHas(value: string, expected: string): boolean {
  let index = 0;
  while (index < value.length) {
    while (index < value.length && isAsciiSpace(compilerStringCharCodeAt(value, index))) index += 1;
    const start = index;
    while (index < value.length && !isAsciiSpace(compilerStringCharCodeAt(value, index)))
      index += 1;
    if (compilerStringSlice(value, start, index) === expected) return true;
  }
  return false;
}

function possibleAssetAttributes(element: JsxIrElement, tag: string): readonly string[] {
  switch (tag) {
    case 'script':
    case 'iframe':
    case 'audio':
    case 'track':
      return ['src'];
    case 'input':
      return staticLowerAttributeValue(element, 'type') === 'image' ? ['src'] : [];
    case 'img':
      return ['src', 'srcset'];
    case 'image':
    case 'feimage':
      return ['href', 'xlink:href'];
    case 'video':
      return ['poster', 'src'];
    case 'source':
      return ['src', 'srcset'];
    case 'link':
      return ['href'];
    default:
      return [];
  }
}

function popupTargetAttribute(element: JsxIrElement, tag: string): JsxIrAttribute | undefined {
  if (tag === 'a' || tag === 'area' || tag === 'form') return effectiveAttribute(element, 'target');
  if (tag === 'button' || tag === 'input') return effectiveAttribute(element, 'formtarget');
  return undefined;
}

function popupTargetIsOpen(attribute: JsxIrAttribute): boolean {
  if (attribute.value.kind !== 'string') return true;
  const target = compilerStringToLowerCase(compilerStringTrim(attribute.value.value));
  return (
    target !== '' &&
    target !== '_self' &&
    target !== '_parent' &&
    target !== '_top' &&
    target !== '_unfencedtop'
  );
}

interface EffectiveAttributeState {
  attribute: JsxIrAttribute | undefined;
  key: string;
}

function effectiveAttribute(element: JsxIrElement, name: string): JsxIrAttribute | undefined {
  const states: EffectiveAttributeState[] = [];
  const visit = (attributes: readonly JsxIrAttribute[], sourceOrdered: boolean): void => {
    const ordered = sourceOrdered ? sourceOrderedAttributes(attributes) : attributes;
    const length = compilerArrayLength(ordered, 'Browser posture element attributes');
    for (let index = 0; index < length; index += 1) {
      const attribute = compilerOwnDataValue(
        ordered,
        index,
        'Browser posture element attributes',
      ) as JsxIrAttribute;
      const source = attribute.source;
      if (source !== undefined && !('name' in source)) {
        const entries = source.staticWireAttributeEntries;
        if (entries === undefined) continue;
        const entryLength = compilerArrayLength(entries, 'Browser posture static spread entries');
        for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
          const entry = compilerOwnDataValue(
            entries,
            entryIndex,
            'Browser posture static spread entries',
          ) as StaticJsxWireAttributeEntry;
          setEffectiveAttribute(states, entry.key, staticWireEntryAttribute(attribute, entry));
        }
        continue;
      }
      setEffectiveAttribute(states, attribute.name, attribute);
    }
  };
  visit(element.attributes, true);
  visit(element.generatedAttributes, false);
  const stateLength = compilerArrayLength(states, 'Browser posture effective attributes');
  for (let index = 0; index < stateLength; index += 1) {
    const state = compilerOwnDataValue(
      states,
      index,
      'Browser posture effective attributes',
    ) as EffectiveAttributeState;
    if (state.attribute === undefined || compilerStringToLowerCase(state.key) !== name) continue;
    return state.attribute;
  }
  return undefined;
}

function sourceOrderedAttributes(attributes: readonly JsxIrAttribute[]): JsxIrAttribute[] {
  const ordered: JsxIrAttribute[] = [];
  const length = compilerArrayLength(attributes, 'Browser posture source attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'Browser posture source attributes',
    ) as JsxIrAttribute;
    const insertionIndex = compilerArrayLength(ordered, 'Browser posture ordered attributes');
    compilerSetOwnDataProperty(ordered, insertionIndex, attribute);
    let cursor = insertionIndex;
    while (cursor > 0) {
      const previous = compilerOwnDataValue(
        ordered,
        cursor - 1,
        'Browser posture ordered attributes',
      ) as JsxIrAttribute;
      const currentStart = attribute.anchor?.start;
      const previousStart = previous.anchor?.start;
      if (
        currentStart === undefined ||
        previousStart === undefined ||
        previousStart <= currentStart
      ) {
        break;
      }
      compilerSetOwnDataProperty(ordered, cursor, previous);
      compilerSetOwnDataProperty(ordered, cursor - 1, attribute);
      cursor -= 1;
    }
  }
  return ordered;
}

function setEffectiveAttribute(
  states: EffectiveAttributeState[],
  key: string,
  attribute: JsxIrAttribute | undefined,
): void {
  const length = compilerArrayLength(states, 'Browser posture effective attributes');
  for (let index = 0; index < length; index += 1) {
    const state = compilerOwnDataValue(
      states,
      index,
      'Browser posture effective attributes',
    ) as EffectiveAttributeState;
    if (state.key !== key) continue;
    state.attribute = attribute;
    return;
  }
  compilerDefineOwnDataProperty(states, length, { attribute, key });
}

function staticWireEntryAttribute(
  spread: JsxIrAttribute,
  entry: StaticJsxWireAttributeEntry,
): JsxIrAttribute | undefined {
  const trustedUrl = parserFactHasFrameworkTrustedUrl(entry);
  const trustedUrlReason = parserFactFrameworkTrustedUrlReason(entry);
  let value: JsxIrAttribute['value'];
  if (trustedUrl) {
    value = {
      kind: 'expression',
      source: 'trustedUrl(...)',
      trustedUrl: true,
      ...(trustedUrlReason === undefined ? {} : { trustedUrlReason }),
    };
  } else if (entry.value.kind === 'unknown') {
    value = { kind: 'expression', source: 'static spread value' };
  } else {
    const staticValue = entry.value.value;
    if (staticValue === undefined || staticValue === false || staticValue === null)
      return undefined;
    if (typeof staticValue === 'string') value = { kind: 'string', value: staticValue };
    else if (typeof staticValue === 'number') value = { kind: 'number', value: staticValue };
    else if (staticValue === true) value = { kind: 'boolean', value: true };
    else value = { kind: 'expression', source: 'non-scalar static spread value' };
  }
  return {
    ...(spread.anchor === undefined ? {} : { anchor: spread.anchor }),
    name: entry.key,
    ownership: spread.ownership,
    provenance: spread.provenance,
    value,
  };
}

function hasOpaqueSpread(element: JsxIrElement): boolean {
  const length = compilerArrayLength(element.attributes, 'Browser posture spread attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Browser posture spread attributes',
    ) as JsxIrAttribute;
    const source = attribute.source;
    if (source !== undefined && !('name' in source)) {
      if (source.staticWireAttributeEntries === undefined) return true;
      continue;
    }
    if (compilerStringStartsWith(attribute.name, '...')) return true;
  }
  return false;
}

function opaqueSpreadNeedsBrowserPostureDiagnostic(tag: string): boolean {
  // The shared element-context validator already closes arbitrary spreads for every ordinary
  // finite-control element. Image inputs are the exception: their mutation-submitter membrane
  // strips transport controls but does not classify browser asset URLs, so posture keeps that
  // rejection. Elements with no finite controls are exclusively posture-owned here.
  return tag === 'input' || !elementHasContextSecurityControls(tag);
}

function staticLowerAttributeValue(element: JsxIrElement, name: string): string | undefined {
  const attribute = effectiveAttribute(element, name);
  return attribute?.value.kind === 'string'
    ? compilerStringToLowerCase(compilerStringTrim(attribute.value.value))
    : undefined;
}

function isLocalAssetUrl(value: string): boolean {
  return (
    compilerStringStartsWith(value, '/') ||
    compilerStringStartsWith(value, './') ||
    compilerStringStartsWith(value, '../') ||
    compilerStringStartsWith(value, '#') ||
    (!compilerStringStartsWith(value, '//') && !compilerStringIncludes(value, ':'))
  );
}

function spanForAttribute(
  element: JsxIrElement,
  attribute: JsxIrAttribute,
): { end: number; start: number } {
  return attribute.anchor === undefined
    ? spanFor(element)
    : { end: attribute.anchor.end, start: attribute.anchor.start };
}

function spanFor(element: JsxIrElement): { end: number; start: number } {
  const anchor = element.provenance.anchor;
  return anchor === undefined
    ? { end: element.element.openingEnd, start: element.element.start }
    : { end: anchor.end, start: anchor.start };
}

function browserPostureDiagnostic(
  options: { readonly fileName: string; readonly source: string },
  span: { readonly end: number; readonly start: number },
  reason: string,
): CompilerDiagnostic {
  return contextualizeCompilerDiagnostic(
    diagnosticFor(options.fileName, 'KV236', options.source, span.start, span.end - span.start),
    {
      help: 'Fixes: keep the asset URL static so Kovo can derive its CSP origin, or use the exact trustedUrl(value, auditedReason) constructor and declare every admitted runtime origin with a rationale. SPEC §2/§4.8 requires browser response posture to fail closed when the compiler cannot derive the browser request authority.',
      message: `Unsafe output context requires an explicit trusted Kovo escape hatch. ${reason}`,
    },
  );
}

function append<Value>(target: Value[], value: Value): void {
  compilerDefineOwnDataProperty(
    target,
    compilerArrayLength(target, 'Browser posture facts'),
    value,
  );
}

function sortedExternalOrigins(
  values: readonly BrowserPostureExternalOrigin[],
): BrowserPostureExternalOrigin[] {
  return insertionSorted(
    values,
    'Browser posture external origins',
    (left, right) =>
      compilerStringLocaleCompare(left.directive, right.directive) ||
      compilerStringLocaleCompare(left.origin, right.origin) ||
      compilerStringLocaleCompare(left.fileName, right.fileName) ||
      left.span.start - right.span.start,
  );
}

function sortedOpaqueUrls(
  values: readonly BrowserPostureOpaqueExternalUrl[],
): BrowserPostureOpaqueExternalUrl[] {
  return insertionSorted(
    values,
    'Browser posture opaque URLs',
    (left, right) =>
      compilerStringLocaleCompare(left.directive, right.directive) ||
      compilerStringLocaleCompare(left.reason, right.reason) ||
      compilerStringLocaleCompare(left.fileName, right.fileName) ||
      left.span.start - right.span.start,
  );
}

function sortedBlockers(
  values: readonly BrowserPostureIsolationBlocker[],
): BrowserPostureIsolationBlocker[] {
  return insertionSorted(
    values,
    'Browser posture isolation blockers',
    (left, right) =>
      compilerStringLocaleCompare(left.kind, right.kind) ||
      compilerStringLocaleCompare(left.fileName, right.fileName) ||
      compilerStringLocaleCompare(left.site, right.site) ||
      (left.span?.start ?? -1) - (right.span?.start ?? -1),
  );
}

function insertionSorted<Value>(
  values: readonly Value[],
  label: string,
  compare: (left: Value, right: Value) => number,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, label);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(sorted[insertion - 1]!, value) > 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}
