import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { isUrlAttribute, type GeneratedOutputWriteFact } from '../output-context-facts.js';
import { literalStringValue } from '../scan/object.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type JsxExpressionModel,
  type JsxSpreadAttributeModel,
  type SourceSpan,
} from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';
export type { OutputContext } from '../output-context-facts.js';

export const runtimeOutputHelpers = {
  escapeHtml: 'kovoEscapeHtml',
  styleProperty: 'kovoStyleProperty',
} as const;

export function stylePropertyExpression(propertyName: string, valueExpression: string): string {
  return `${runtimeOutputHelpers.styleProperty}(${JSON.stringify(propertyName)}, ${valueExpression.trim()})`;
}

export function templateStampHtmlEscapeExpression(valueExpression: string): string {
  return `${runtimeOutputHelpers.escapeHtml}(${valueExpression})`;
}

export function validateOutputContexts(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  compilerOwnedStyleSpans: readonly SourceSpan[] = [],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    diagnostics.push(
      ...validateElementAttributes(source, element, options.fileName, compilerOwnedStyleSpans),
    );
    diagnostics.push(...validateRawtextElementText(source, model, element, options.fileName));
  }

  diagnostics.push(...validateComponentCssText(source, model, options.fileName));

  return diagnostics;
}

/**
 * SPEC §4.8:356-358 / §5.2 #10 (KV236): `<script>` and `<style>` element text are unsafe RAWTEXT
 * output contexts. Their content is not HTML-entity-decoded, so the framework's `escapeText`
 * (`&<>` only) is the wrong encoder and provably does not neutralize attacker-influenced bytes in
 * JS/CSS context. Any dynamic (query/state-derived) text child of a rawtext element that is not an
 * explicit `trustedHtml(...)` brand is therefore KV236, exactly like a binding into the matching
 * attribute sink (B1 = script XSS, B2 = style CSS-injection).
 */
function validateRawtextElementText(
  source: string,
  model: ComponentModuleModel,
  element: JsxElementModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (element.tag !== 'script' && element.tag !== 'style') return [];

  const diagnostics: CompilerDiagnostic[] = [];
  for (const child of directChildExpressions(model, element)) {
    if (!isDynamicExpression(child) || isTrustedHtmlExpression(child)) continue;
    diagnostics.push(
      outputContextDiagnostic({
        detail: `dynamic <${element.tag}> element text`,
        fileName,
        length: child.containerEnd - child.containerStart,
        source,
        start: child.containerStart,
      }),
    );
  }
  return diagnostics;
}

/** Direct (non-nested) `{expr}` text children of an element, matched by container span. */
function directChildExpressions(
  model: ComponentModuleModel,
  element: JsxElementModel,
): JsxExpressionModel[] {
  return element.childExpressionContainers.flatMap((container) => {
    const expression = model.jsxExpressions.find(
      (candidate) =>
        candidate.containerStart === container.start && candidate.containerEnd === container.end,
    );
    return expression ? [expression] : [];
  });
}

/**
 * A text child carries attacker-influenceable bytes when it reads a reactive root (query/state)
 * or any free identifier — i.e. it is not a self-contained literal. A pure literal interpolation
 * (`{"safe"}`, `{42}`) has no references and no property accesses and is not a sink.
 */
function isDynamicExpression(expression: JsxExpressionModel): boolean {
  return expression.references.length > 0 || expression.propertyAccesses.length > 0;
}

/** SPEC §4.8 escape hatch: a `trustedHtml(...)` brand is the only suppression of KV236. */
function isTrustedHtmlExpression(expression: JsxExpressionModel): boolean {
  return /^trustedHtml\s*\(/.test(expression.expression.trim());
}

export function collectTrustedHtmlOutputContextFacts(
  model: ComponentModuleModel,
): GeneratedOutputWriteFact[] {
  const facts: GeneratedOutputWriteFact[] = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes) {
      if (!isRawHtmlAttribute(attribute.name) || literalAttributeStringValue(attribute) !== null) {
        continue;
      }

      facts.push({
        context: 'trusted-html',
        ...(attribute.expression ? { expression: attribute.expression } : {}),
        sink: attribute.name,
        source: 'server-render',
        writer: 'trusted raw HTML attribute',
      });
    }
  }

  return facts;
}

function validateElementAttributes(
  source: string,
  element: JsxElementModel,
  fileName: string,
  compilerOwnedStyleSpans: readonly SourceSpan[],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const hasExternalEscape = element.attributes.some((attribute) => attribute.name === 'external');

  for (const attribute of element.attributes) {
    if (isUrlAttribute(attribute.name)) {
      diagnostics.push(...validateUrlAttribute(source, attribute, hasExternalEscape, fileName));
      continue;
    }

    if (attribute.name === 'style') {
      if (spanContainsAttribute(compilerOwnedStyleSpans, attribute)) continue;
      diagnostics.push(...validateStyleAttribute(source, attribute, fileName));
      continue;
    }

    if (attribute.name === 'data-bind:style') {
      diagnostics.push(
        outputContextDiagnostic({
          detail: 'dynamic style attribute binding',
          fileName,
          length: attribute.end - attribute.start,
          source,
          start: attribute.start,
        }),
      );
      continue;
    }

    if (attribute.name === 'data-derive-attr' && attribute.value === 'style') {
      diagnostics.push(
        outputContextDiagnostic({
          detail: 'arbitrary dynamic CSS text',
          fileName,
          length: attribute.end - attribute.start,
          source,
          start: attribute.start,
        }),
      );
      continue;
    }

    if (isRawHtmlAttribute(attribute.name)) {
      diagnostics.push(...validateRawHtmlAttribute(source, attribute, fileName));
      continue;
    }

    // KV236: dynamic event-handler attributes (data-bind:on* or data-derive-attr on*)
    if (isDynamicEventHandlerAttribute(attribute)) {
      diagnostics.push(
        outputContextDiagnostic({
          detail: `${attribute.name} is a dynamic event-handler sink (on* attribute)`,
          fileName,
          length: attribute.end - attribute.start,
          source,
          start: attribute.start,
        }),
      );
      continue;
    }

    // KV236: dynamic srcdoc attribute (data-bind:srcdoc or data-derive-attr srcdoc)
    if (isDynamicSrcdocAttribute(attribute)) {
      diagnostics.push(
        outputContextDiagnostic({
          detail: `${attribute.name} is a dynamic srcdoc sink`,
          fileName,
          length: attribute.end - attribute.start,
          source,
          start: attribute.start,
        }),
      );
      continue;
    }

    // KV236: dynamic formaction attribute (data-bind:formaction or data-derive-attr formaction)
    if (isDynamicFormactionAttribute(attribute)) {
      diagnostics.push(
        outputContextDiagnostic({
          detail: `${attribute.name} is a dynamic formaction sink`,
          fileName,
          length: attribute.end - attribute.start,
          source,
          start: attribute.start,
        }),
      );
      continue;
    }
  }

  // SPEC §4.8 / §5.2 #10 (KV236, A3): output-context validation must also expand static object
  // spreads (`<a {...{ href: 'javascript:…' }}>`). The spread lowers to a directly-authored
  // attribute, so the same URL-scheme / raw-HTML / on* / srcdoc checks must run over its object
  // entries; otherwise the spread is a silent bypass of the sink validation the direct form gets.
  for (const spread of element.spreadAttributes) {
    diagnostics.push(...validateStaticSpreadEntries(source, spread, hasExternalEscape, fileName));
  }

  return diagnostics;
}

/**
 * SPEC §4.8 (KV236, A3): validate each entry of a static object spread as if it were a directly
 * authored attribute. Only literal (non-dynamic) string values are statically decidable here; a
 * dynamic spread value flows through the binding/derive sinks gated elsewhere. The synthesized
 * attribute reuses the existing per-sink validators so the spread and direct forms cannot diverge.
 */
function validateStaticSpreadEntries(
  source: string,
  spread: JsxSpreadAttributeModel,
  hasExternalEscape: boolean,
  fileName: string,
): CompilerDiagnostic[] {
  if (!spread.objectEntries) return [];

  const diagnostics: CompilerDiagnostic[] = [];
  for (const entry of spread.objectEntries) {
    if (entry.value === undefined) continue;
    const literal = literalStringValue(entry.value);
    if (literal === null) continue;
    const synthetic: JsxAttributeModel = {
      end: spread.end,
      leadingStart: spread.start,
      name: entry.key,
      start: spread.start,
      value: literal,
    };

    if (isUrlAttribute(synthetic.name)) {
      diagnostics.push(...validateUrlAttribute(source, synthetic, hasExternalEscape, fileName));
      continue;
    }
    if (isRawHtmlAttribute(synthetic.name)) {
      diagnostics.push(...validateRawHtmlAttribute(source, synthetic, fileName));
      continue;
    }
    if (/^on/i.test(synthetic.name)) {
      diagnostics.push(
        outputContextDiagnostic({
          detail: `${synthetic.name} is an event-handler sink (on* attribute)`,
          fileName,
          length: spread.end - spread.start,
          source,
          start: spread.start,
        }),
      );
      continue;
    }
    if (synthetic.name === 'srcdoc') {
      diagnostics.push(...validateRawHtmlAttribute(source, synthetic, fileName));
      continue;
    }
  }
  return diagnostics;
}

function spanContainsAttribute(
  spans: readonly SourceSpan[],
  attribute: JsxAttributeModel,
): boolean {
  return spans.some((span) => attribute.start >= span.start && attribute.end <= span.end);
}

function validateUrlAttribute(
  source: string,
  attribute: JsxAttributeModel,
  hasExternalEscape: boolean,
  fileName: string,
): CompilerDiagnostic[] {
  const value = literalAttributeStringValue(attribute);
  if (value === null) return [];

  if (hasUnsafeUrlScheme(value)) {
    return [
      outputContextDiagnostic({
        detail: `${attribute.name}=${JSON.stringify(value)} uses an unsafe URL scheme`,
        fileName,
        length: attribute.end - attribute.start,
        source,
        start: attribute.start,
      }),
    ];
  }

  if (isExternalHttpUrl(value) && !hasExternalEscape) {
    return [
      outputContextDiagnostic({
        detail: `${attribute.name}=${JSON.stringify(value)} is an external literal URL without external`,
        fileName,
        length: attribute.end - attribute.start,
        source,
        start: attribute.start,
      }),
    ];
  }

  return [];
}

function validateStyleAttribute(
  source: string,
  attribute: JsxAttributeModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (attribute.expression === undefined) return validateStaticCssText(source, attribute, fileName);
  if (attribute.expressionObjectEntries) return [];

  return [
    outputContextDiagnostic({
      detail: 'dynamic style text',
      fileName,
      length: attribute.end - attribute.start,
      source,
      start: attribute.start,
    }),
  ];
}

function validateStaticCssText(
  source: string,
  attribute: JsxAttributeModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (!attribute.value || !cssTextHasUnsafeUrl(attribute.value)) return [];

  return [
    outputContextDiagnostic({
      detail: 'style attribute contains an unsafe CSS url()',
      fileName,
      length: attribute.end - attribute.start,
      source,
      start: attribute.start,
    }),
  ];
}

function validateRawHtmlAttribute(
  source: string,
  attribute: JsxAttributeModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (literalAttributeStringValue(attribute) === null) return [];

  return [
    outputContextDiagnostic({
      detail: `${attribute.name} receives a plain string; use Kovo TrustedHtml`,
      fileName,
      length: attribute.end - attribute.start,
      source,
      start: attribute.start,
    }),
  ];
}

function validateComponentCssText(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const component of model.components) {
    for (const option of component.options) {
      if (option.key !== 'css' && option.key !== 'styles') continue;
      if (!option.staticTemplateValue || !cssTextHasUnsafeUrl(option.staticTemplateValue)) continue;

      diagnostics.push(
        outputContextDiagnostic({
          detail: `${option.key} contains an unsafe CSS url()`,
          fileName,
          source,
        }),
      );
    }
  }

  return diagnostics;
}

function literalAttributeStringValue(attribute: JsxAttributeModel): string | null {
  if (attribute.value !== undefined) return attribute.value;
  return typeof attribute.expressionStaticValue === 'string'
    ? attribute.expressionStaticValue
    : null;
}

/**
 * Returns the bound or derived attribute name for dynamic attribute sinks.
 * For `data-bind:foo` the dynamic name is "foo".
 * For `data-derive-attr` with value "foo" the dynamic name is "foo".
 */
function dynamicAttributeName(attribute: JsxAttributeModel): string | null {
  if (attribute.name.startsWith('data-bind:')) {
    return attribute.name.slice('data-bind:'.length);
  }
  if (attribute.name === 'data-derive-attr' && typeof attribute.value === 'string') {
    return attribute.value;
  }
  return null;
}

/** Returns true when the attribute dynamically targets an on* event-handler sink. */
function isDynamicEventHandlerAttribute(attribute: JsxAttributeModel): boolean {
  const name = dynamicAttributeName(attribute);
  return name !== null && /^on/i.test(name);
}

/** Returns true when the attribute dynamically targets the srcdoc sink. */
function isDynamicSrcdocAttribute(attribute: JsxAttributeModel): boolean {
  const name = dynamicAttributeName(attribute);
  return name === 'srcdoc';
}

/** Returns true when the attribute dynamically targets the formaction sink. */
function isDynamicFormactionAttribute(attribute: JsxAttributeModel): boolean {
  const name = dynamicAttributeName(attribute);
  return name === 'formaction';
}

function isRawHtmlAttribute(name: string): boolean {
  return (
    name === 'dangerouslySetInnerHTML' ||
    name === 'innerHTML' ||
    name === 'rawHtml' ||
    name === 'html'
  );
}

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = stripAsciiControlAndSpace(value).toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!match) return false;

  return !SAFE_URL_SCHEMES.has(match[1] ?? '');
}

function stripAsciiControlAndSpace(value: string): string {
  let normalized = '';
  for (const char of value) {
    if (char.charCodeAt(0) > 0x20) normalized += char;
  }
  return normalized;
}

function isExternalHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function cssTextHasUnsafeUrl(cssText: string): boolean {
  for (const value of cssUrlValues(cssText)) {
    if (hasUnsafeUrlScheme(value)) return true;
  }

  return false;
}

function cssUrlValues(cssText: string): string[] {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < cssText.length) {
    const urlIndex = cssText.toLowerCase().indexOf('url(', cursor);
    if (urlIndex === -1) break;
    let index = urlIndex + 'url('.length;
    while (index < cssText.length && /\s/.test(cssText[index] ?? '')) index += 1;

    const quote = cssText[index] === '"' || cssText[index] === "'" ? cssText[index] : undefined;
    if (quote) index += 1;

    const start = index;
    while (index < cssText.length) {
      const char = cssText[index];
      if (quote) {
        if (char === quote && cssText[index - 1] !== '\\') break;
      } else if (char === ')') {
        break;
      }
      index += 1;
    }

    values.push(cssText.slice(start, index).trim());
    cursor = cssText.indexOf(')', index);
    if (cursor === -1) break;
    cursor += 1;
  }

  return values;
}

function outputContextDiagnostic({
  detail,
  fileName,
  length,
  source,
  start,
}: {
  detail: string;
  fileName: string;
  length?: number;
  source: string;
  start?: number;
}): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV236', source, start, length),
    help: diagnosticDefinitions.KV236.help,
    message: `${diagnosticDefinitions.KV236.message} ${detail}`,
  };
}
