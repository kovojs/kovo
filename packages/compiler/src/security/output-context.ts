import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { isUrlAttribute, type GeneratedOutputWriteFact } from '../output-context-facts.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  compilerOwnedStyleSpans: readonly SourceSpan[] = [],
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    found.push(...validateElementAttributes(diagnostics, element, compilerOwnedStyleSpans));
  }

  found.push(...validateComponentCssText(diagnostics, model));

  return found;
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
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  compilerOwnedStyleSpans: readonly SourceSpan[],
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const hasExternalEscape = element.attributes.some((attribute) => attribute.name === 'external');

  for (const attribute of element.attributes) {
    if (isUrlAttribute(attribute.name)) {
      found.push(...validateUrlAttribute(diagnostics, attribute, hasExternalEscape));
      continue;
    }

    if (attribute.name === 'style') {
      if (spanContainsAttribute(compilerOwnedStyleSpans, attribute)) continue;
      found.push(...validateStyleAttribute(diagnostics, attribute));
      continue;
    }

    if (attribute.name === 'data-bind:style') {
      found.push(
        outputContextDiagnostic(diagnostics, 'dynamic style attribute binding', {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
      );
      continue;
    }

    if (attribute.name === 'data-derive-attr' && attribute.value === 'style') {
      found.push(
        outputContextDiagnostic(diagnostics, 'arbitrary dynamic CSS text', {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
      );
      continue;
    }

    if (isRawHtmlAttribute(attribute.name)) {
      found.push(...validateRawHtmlAttribute(diagnostics, attribute));
      continue;
    }

    // KV236: dynamic event-handler attributes (data-bind:on* or data-derive-attr on*)
    if (isDynamicEventHandlerAttribute(attribute)) {
      found.push(
        outputContextDiagnostic(
          diagnostics,
          `${attribute.name} is a dynamic event-handler sink (on* attribute)`,
          { start: attribute.start, length: attribute.end - attribute.start },
        ),
      );
      continue;
    }

    // KV236: dynamic srcdoc attribute (data-bind:srcdoc or data-derive-attr srcdoc)
    if (isDynamicSrcdocAttribute(attribute)) {
      found.push(
        outputContextDiagnostic(diagnostics, `${attribute.name} is a dynamic srcdoc sink`, {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
      );
      continue;
    }

    // KV236: dynamic formaction attribute (data-bind:formaction or data-derive-attr formaction)
    if (isDynamicFormactionAttribute(attribute)) {
      found.push(
        outputContextDiagnostic(diagnostics, `${attribute.name} is a dynamic formaction sink`, {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
      );
      continue;
    }
  }

  return found;
}

function spanContainsAttribute(
  spans: readonly SourceSpan[],
  attribute: JsxAttributeModel,
): boolean {
  return spans.some((span) => attribute.start >= span.start && attribute.end <= span.end);
}

function validateUrlAttribute(
  diagnostics: DiagnosticFactory,
  attribute: JsxAttributeModel,
  hasExternalEscape: boolean,
): CompilerDiagnostic[] {
  const value = literalAttributeStringValue(attribute);
  if (value === null) return [];

  if (hasUnsafeUrlScheme(value)) {
    return [
      outputContextDiagnostic(
        diagnostics,
        `${attribute.name}=${JSON.stringify(value)} uses an unsafe URL scheme`,
        { start: attribute.start, length: attribute.end - attribute.start },
      ),
    ];
  }

  if (isExternalHttpUrl(value) && !hasExternalEscape) {
    return [
      outputContextDiagnostic(
        diagnostics,
        `${attribute.name}=${JSON.stringify(value)} is an external literal URL without external`,
        { start: attribute.start, length: attribute.end - attribute.start },
      ),
    ];
  }

  return [];
}

function validateStyleAttribute(
  diagnostics: DiagnosticFactory,
  attribute: JsxAttributeModel,
): CompilerDiagnostic[] {
  if (attribute.expression === undefined) return validateStaticCssText(diagnostics, attribute);
  if (attribute.expressionObjectEntries) return [];

  return [
    outputContextDiagnostic(diagnostics, 'dynamic style text', {
      start: attribute.start,
      length: attribute.end - attribute.start,
    }),
  ];
}

function validateStaticCssText(
  diagnostics: DiagnosticFactory,
  attribute: JsxAttributeModel,
): CompilerDiagnostic[] {
  if (!attribute.value || !cssTextHasUnsafeUrl(attribute.value)) return [];

  return [
    outputContextDiagnostic(diagnostics, 'style attribute contains an unsafe CSS url()', {
      start: attribute.start,
      length: attribute.end - attribute.start,
    }),
  ];
}

function validateRawHtmlAttribute(
  diagnostics: DiagnosticFactory,
  attribute: JsxAttributeModel,
): CompilerDiagnostic[] {
  if (literalAttributeStringValue(attribute) === null) return [];

  return [
    outputContextDiagnostic(
      diagnostics,
      `${attribute.name} receives a plain string; use Kovo TrustedHtml`,
      { start: attribute.start, length: attribute.end - attribute.start },
    ),
  ];
}

function validateComponentCssText(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  for (const component of model.components) {
    for (const option of component.options) {
      if (option.key !== 'css' && option.key !== 'styles') continue;
      if (!option.staticTemplateValue || !cssTextHasUnsafeUrl(option.staticTemplateValue)) continue;

      found.push(outputContextDiagnostic(diagnostics, `${option.key} contains an unsafe CSS url()`));
    }
  }

  return found;
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

function outputContextDiagnostic(
  diagnostics: DiagnosticFactory,
  detail: string,
  span?: { start?: number | undefined; length?: number | undefined },
): CompilerDiagnostic {
  return {
    ...diagnostics.at('KV236', span, detail),
    help: diagnosticDefinitions.KV236.help,
  };
}
