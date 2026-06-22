import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
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
    found.push(...validateRawtextElementText(diagnostics, model, element));
  }

  found.push(...validateComponentCssText(diagnostics, model));

  return found;
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  element: JsxElementModel,
): CompilerDiagnostic[] {
  if (element.tag !== 'script' && element.tag !== 'style') return [];

  const found: CompilerDiagnostic[] = [];
  for (const child of directChildExpressions(model, element)) {
    if (!isDynamicExpression(child) || isTrustedHtmlExpression(child)) continue;
    found.push(
      outputContextDiagnostic(diagnostics, `dynamic <${element.tag}> element text`, {
        start: child.containerStart,
        length: child.containerEnd - child.containerStart,
      }),
    );
  }
  return found;
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

  // SPEC §4.8 / §5.2 #10 (KV236, A3): output-context validation must also expand static object
  // spreads (`<a {...{ href: 'javascript:…' }}>`). The spread lowers to a directly-authored
  // attribute, so the same URL-scheme / raw-HTML / on* / srcdoc checks must run over its object
  // entries; otherwise the spread is a silent bypass of the sink validation the direct form gets.
  for (const spread of element.spreadAttributes) {
    found.push(...validateStaticSpreadEntries(diagnostics, spread, hasExternalEscape));
  }

  return found;
}

/**
 * SPEC §4.8 (KV236, A3): validate each entry of a static object spread as if it were a directly
 * authored attribute. Only literal (non-dynamic) string values are statically decidable here; a
 * dynamic spread value flows through the binding/derive sinks gated elsewhere. The synthesized
 * attribute reuses the existing per-sink validators so the spread and direct forms cannot diverge.
 */
function validateStaticSpreadEntries(
  diagnostics: DiagnosticFactory,
  spread: JsxSpreadAttributeModel,
  hasExternalEscape: boolean,
): CompilerDiagnostic[] {
  if (!spread.objectEntries) return [];

  const found: CompilerDiagnostic[] = [];
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
      found.push(...validateUrlAttribute(diagnostics, synthetic, hasExternalEscape));
      continue;
    }
    if (isRawHtmlAttribute(synthetic.name)) {
      found.push(...validateRawHtmlAttribute(diagnostics, synthetic));
      continue;
    }
    if (/^on/i.test(synthetic.name)) {
      found.push(
        outputContextDiagnostic(
          diagnostics,
          `${synthetic.name} is an event-handler sink (on* attribute)`,
          {
            start: spread.start,
            length: spread.end - spread.start,
          },
        ),
      );
      continue;
    }
    if (synthetic.name === 'srcdoc') {
      found.push(...validateRawHtmlAttribute(diagnostics, synthetic));
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

      found.push(
        outputContextDiagnostic(diagnostics, `${option.key} contains an unsafe CSS url()`),
      );
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
