import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { isUrlAttribute, type GeneratedOutputWriteFact } from '../output-context-facts.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
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
  }

  diagnostics.push(...validateComponentCssText(source, model, options.fileName));

  return diagnostics;
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
