import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  expressionAtSpan,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { hasUnsafeUrlScheme } from '@kovojs/core/internal/security-url';
import { isBlockedSvgSmilElementName } from '@kovojs/core/internal/sink-policy';
import {
  htmlAttributeWireValuePosture,
  htmlElementWireValueIssue,
  htmlTextWireValuePosture,
  htmlWireValueIssue,
  isGeneratedOnlySemanticAttribute,
  type HtmlWireValuePosture,
} from '@kovojs/core/internal/semantic-attributes';
import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerJsonStringify,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetHas,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import {
  isUrlAttribute,
  expressionResolvesToTrustedHtmlBrand,
  expressionResolvesToTrustedUrlPureBrand,
  trustedHtmlBrandLocalNames,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import { literalStringValue } from '../scan/object.js';
import {
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type JsxExpressionModel,
  type ObjectLiteralEntry,
  type SourceSpan,
  type StaticJsxWireAttributeEntry,
} from '../scan/parse.js';
export type { OutputContext } from '../output-context-facts.js';

export const runtimeOutputHelpers = {
  escapeHtml: 'kovoEscapeHtml',
  styleProperty: 'kovoStyleProperty',
} as const;

export function stylePropertyExpression(propertyName: string, valueExpression: string): string {
  return `${runtimeOutputHelpers.styleProperty}(${outputJsonString(propertyName)}, ${compilerStringTrim(valueExpression)})`;
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

  const trustedBrandNames = trustedHtmlBrandLocalNames(model);

  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Output-context JSX elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = outputArrayValue(elements, index, 'Output-context JSX elements');
    appendOutputItems(
      found,
      validateElementAttributes(diagnostics, model, element, compilerOwnedStyleSpans),
      'Output-context attribute diagnostics',
    );
    appendOutputItems(
      found,
      validateSubmittedElementText(diagnostics, model, element),
      'Output-context submitted-text diagnostics',
    );
    appendOutputItems(
      found,
      validateRawtextElementText(diagnostics, model, element, trustedBrandNames),
      'Output-context RAWTEXT diagnostics',
    );
  }

  appendOutputItems(
    found,
    validateComponentCssText(diagnostics, model),
    'Output-context component CSS diagnostics',
  );

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
  trustedBrandNames: ReadonlySet<string>,
): CompilerDiagnostic[] {
  if (element.tag !== 'script' && element.tag !== 'style') return [];

  const found: CompilerDiagnostic[] = [];
  const children = directChildExpressions(model, element);
  const childLength = compilerArrayLength(children, 'Direct RAWTEXT child expressions');
  for (let index = 0; index < childLength; index += 1) {
    const child = outputArrayValue(children, index, 'Direct RAWTEXT child expressions');
    if (!isDynamicExpression(child) || isTrustedBrandCall(model, child, trustedBrandNames))
      continue;
    compilerArrayAppend(
      found,
      outputContextDiagnostic(diagnostics, `dynamic <${element.tag}> element text`, {
        start: child.containerStart,
        length: child.containerEnd - child.containerStart,
      }),
      'RAWTEXT diagnostics',
    );
  }
  return found;
}

/** Direct (non-nested) `{expr}` text children of an element, matched by container span. */
function directChildExpressions(
  model: ComponentModuleModel,
  element: JsxElementModel,
): JsxExpressionModel[] {
  const found: JsxExpressionModel[] = [];
  const containers = element.childExpressionContainers;
  const expressions = jsxExpressions(model);
  const containerLength = compilerArrayLength(containers, 'JSX child expression containers');
  const expressionLength = compilerArrayLength(expressions, 'JSX expressions');

  for (let containerIndex = 0; containerIndex < containerLength; containerIndex += 1) {
    const container = compilerOwnDataValue(
      containers,
      containerIndex,
      'JSX child expression containers',
    ) as SourceSpan | undefined;
    if (!container) {
      throw new TypeError(
        `JSX child expression containers[${containerIndex}] must be an own source span.`,
      );
    }
    for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
      const expression = compilerOwnDataValue(expressions, expressionIndex, 'JSX expressions') as
        | JsxExpressionModel
        | undefined;
      if (!expression) {
        throw new TypeError(`JSX expressions[${expressionIndex}] must be an own expression fact.`);
      }
      if (
        expression.containerStart === container.start &&
        expression.containerEnd === container.end
      ) {
        compilerArrayAppend(found, expression, 'Direct RAWTEXT child expressions');
        break;
      }
    }
  }
  return found;
}

/**
 * A text child carries attacker-influenceable bytes when it reads a reactive root (query/state)
 * or any free identifier — i.e. it is not a self-contained literal. A pure literal interpolation
 * (`{"safe"}`, `{42}`) has no references and no property accesses and is not a sink.
 */
function isDynamicExpression(expression: JsxExpressionModel): boolean {
  return expression.references.length > 0 || expression.propertyAccesses.length > 0;
}

/**
 * SPEC §4.8 escape hatch: a `trustedHtml(...)`/`safeRichHtml(...)` brand is the only suppression of
 * KV236 in a rawtext context. SPEC §6.6(1) / §5.2 rule 9 require this be decided by AST
 * symbol-identity (typed facts), never by the raw expression text. The suppression therefore holds
 * ONLY when the whole expression is EXACTLY a single call (`expression.callName`, set by the parser
 * only for an un-decorated `name(...)` after unwrapping parens/casts) to a name bound to the real
 * `@kovojs/browser` brand export. Consequences, all fail-closed:
 *   - a binary/concatenated expression (`trustedHtml("x") + user.code`) has `callName === undefined`,
 *     so the attacker-influenced operand can no longer ride a prefix `trustedHtml(` match into the sink;
 *   - a shadowing local `const trustedHtml = …` or a same-named import from a non-Kovo module is
 *     absent from `trustedBrandNames`, so it cannot vouch for the value;
 *   - a method/optional-chain/await wrapper (`trustedHtml(x).slice(1)`, `trustedHtml(x) ?? y`) is not
 *     a bare call, so `callName` is undefined and KV236 fires.
 */
function isTrustedBrandCall(
  model: ComponentModuleModel,
  expression: JsxExpressionModel,
  trustedBrandNames: ReadonlySet<string>,
): boolean {
  if (expression.callName !== undefined && compilerSetHas(trustedBrandNames, expression.callName)) {
    return true;
  }
  const astExpression = expressionAtSpan(
    ts as FrameworkIdentityTypeScript,
    model.sourceFile,
    expression,
  );
  if (!astExpression || !ts.isCallExpression(astExpression)) return false;
  return expressionResolvesToTrustedHtmlBrand(model.sourceFile, astExpression.expression);
}

export function collectTrustedHtmlOutputContextFacts(
  model: ComponentModuleModel,
): GeneratedOutputWriteFact[] {
  const facts: GeneratedOutputWriteFact[] = [];

  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Trusted HTML JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = outputArrayValue(elements, elementIndex, 'Trusted HTML JSX elements');
    const attributeLength = compilerArrayLength(element.attributes, 'Trusted HTML attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = outputArrayValue(
        element.attributes,
        attributeIndex,
        'Trusted HTML attributes',
      );
      if (!isRawHtmlAttribute(attribute.name) || literalAttributeStringValue(attribute) !== null) {
        continue;
      }

      compilerArrayAppend(
        facts,
        {
          context: 'trusted-html',
          ...(attribute.expression ? { expression: attribute.expression } : {}),
          sink: attribute.name,
          source: 'server-render',
          writer: 'trusted raw HTML attribute',
        },
        'Trusted HTML output-context facts',
      );
    }
  }

  return facts;
}

function validateElementAttributes(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  element: JsxElementModel,
  compilerOwnedStyleSpans: readonly SourceSpan[],
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  let hasExternalEscape = false;
  const attributeLength = compilerArrayLength(element.attributes, 'Element attributes');
  if (
    element.intrinsicTagName !== undefined &&
    isBlockedSvgSmilElementName(element.intrinsicTagName)
  ) {
    compilerArrayAppend(
      found,
      {
        ...diagnostics.at(
          'KV236',
          {
            start: element.start,
            length: element.openingEnd - element.start,
          },
          `SVG <${element.intrinsicTagName}> is disabled because SMIL can transfer values into URL, event-handler, or style sinks`,
        ),
        help: [
          'Blocked reason: SVG SMIL values/from/to/by and attributeName are one temporal sink; per-attribute escaping cannot prove their browser execution order or href-targeted destination.',
          'Fixes: use Kovo state plus property-level CSS/DOM updates, or render a non-animated SVG representation.',
          'SPEC §4.8 and §5.2 rule 10 require contextual output safety and fail-closed dynamic sinks.',
          'Escape: there is no plain JSX suppression for disabled SVG SMIL elements.',
        ].join('\n'),
      },
      'SVG SMIL element diagnostics',
    );
  }
  appendOutputItems(
    found,
    validateDocumentNavigationElements(diagnostics, element),
    'Document navigation element diagnostics',
  );
  appendOutputItems(
    found,
    validateElementContextSecuritySinks(diagnostics, model, element),
    'Element-context security diagnostics',
  );
  appendOutputItems(
    found,
    validateCrossAttributeWireSemantics(diagnostics, element),
    'Cross-attribute wire diagnostics',
  );
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = outputArrayValue(element.attributes, index, 'Element attributes');
    if (attribute.name === 'external') {
      hasExternalEscape = true;
      break;
    }
  }

  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = outputArrayValue(element.attributes, index, 'Element attributes');
    appendOutputItems(
      found,
      validateWireStableAttribute(diagnostics, element.intrinsicTagName, attribute),
      'Wire-stable attribute diagnostics',
    );
    if (isUrlAttribute(attribute.name)) {
      appendOutputItems(
        found,
        validateUrlAttribute(diagnostics, attribute, hasExternalEscape),
        'URL attribute diagnostics',
      );
      continue;
    }

    if (attribute.name === 'style') {
      if (spanContainsAttribute(compilerOwnedStyleSpans, attribute)) continue;
      appendOutputItems(
        found,
        validateStyleAttribute(diagnostics, attribute),
        'Style attribute diagnostics',
      );
      continue;
    }

    const generatedControlTarget = dynamicGeneratedControlPlaneTarget(attribute);
    if (generatedControlTarget !== null) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(
          diagnostics,
          `${attribute.name} dynamically targets compiler-generated control-plane attribute "${generatedControlTarget}"`,
          { start: attribute.start, length: attribute.end - attribute.start },
        ),
        'Element attribute diagnostics',
      );
      continue;
    }

    if (attribute.name === 'data-bind:style') {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(diagnostics, 'dynamic style attribute binding', {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
        'Element attribute diagnostics',
      );
      continue;
    }

    if (attribute.name === 'data-derive-attr' && attribute.value === 'style') {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(diagnostics, 'arbitrary dynamic CSS text', {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
        'Element attribute diagnostics',
      );
      continue;
    }

    if (isRawHtmlAttribute(attribute.name)) {
      appendOutputItems(
        found,
        validateRawHtmlAttribute(diagnostics, attribute),
        'Raw HTML attribute diagnostics',
      );
      continue;
    }

    if (attribute.name === 'srcdoc') {
      appendOutputItems(
        found,
        validateRawHtmlAttribute(diagnostics, attribute),
        'srcdoc attribute diagnostics',
      );
      continue;
    }

    if (isDirectHtmlEventHandlerAttribute(attribute)) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(
          diagnostics,
          `${attribute.name} is an event-handler sink (on* attribute)`,
          { start: attribute.start, length: attribute.end - attribute.start },
        ),
        'Element attribute diagnostics',
      );
      continue;
    }

    // KV236: dynamic event-handler attributes (data-bind:on* or data-derive-attr on*)
    if (isDynamicEventHandlerAttribute(attribute)) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(
          diagnostics,
          `${attribute.name} is a dynamic event-handler sink (on* attribute)`,
          { start: attribute.start, length: attribute.end - attribute.start },
        ),
        'Element attribute diagnostics',
      );
      continue;
    }

    // KV236: dynamic srcdoc attribute (data-bind:srcdoc or data-derive-attr srcdoc)
    if (isDynamicSrcdocAttribute(attribute)) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(diagnostics, `${attribute.name} is a dynamic srcdoc sink`, {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
        'Element attribute diagnostics',
      );
      continue;
    }

    // KV236: dynamic formaction attribute (data-bind:formaction or data-derive-attr formaction)
    if (isDynamicFormactionAttribute(attribute)) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(diagnostics, `${attribute.name} is a dynamic formaction sink`, {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
        'Element attribute diagnostics',
      );
      continue;
    }
  }

  // SPEC §4.8 / §5.2 #10 (KV236, A3): output-context validation must also expand static object
  // spreads (`<a {...{ href: 'javascript:…' }}>`). The spread lowers to a directly-authored
  // attribute, so the same URL-scheme / style-CSS-url / raw-HTML / on* / srcdoc checks must run
  // over its object entries; otherwise the spread is a silent bypass of the sink validation the
  // direct form gets.
  const spreadLength = compilerArrayLength(element.spreadAttributes, 'Element spread attributes');
  for (let index = 0; index < spreadLength; index += 1) {
    const spread = outputArrayValue(element.spreadAttributes, index, 'Element spread attributes');
    if (!spread.objectEntries) continue;
    appendOutputItems(
      found,
      validateStaticObjectEntrySinks(
        diagnostics,
        spread.objectEntries,
        { end: spread.end, start: spread.start },
        hasExternalEscape,
        element.intrinsicTagName,
      ),
      'Spread attribute diagnostics',
    );
  }

  // SPEC §4.8 / §5.2 #10 (KV236, P2-1): the primitive-composition `attrs={{…}}` bag lowers (via
  // `mergePrimitiveAndAuthorAttributes`) to directly-authored attributes on the child element AFTER
  // this validator runs, so its static sink entries must re-enter the SAME per-sink checks here or
  // a `javascript:` URL / CSS-url / raw-HTML / on* / srcdoc inside `attrs` is a silent KV236 bypass
  // that only the runtime sink-policy floor catches. Only inline `attrs={{…}}` object literals are a
  // merge channel (matching `primitiveCompositionCandidates`' `expressionObjectEntries` gate); a
  // dynamic `attrs` value carries no statically-decidable literal sink and is deferred to runtime.
  appendOutputItems(
    found,
    validatePrimitiveAttrsEntries(diagnostics, element, hasExternalEscape),
    'Primitive attrs diagnostics',
  );

  return found;
}

/**
 * SPEC §4.8 / §5.2 rule 10: `<base>` and meta refresh are document-wide navigation
 * capabilities, not ordinary URL/text attributes. Per-attribute URL sanitization cannot prove the
 * pair semantics of `meta[http-equiv=refresh] content`, and a safe-scheme `<base href>` can still
 * retarget every later relative URL in the document. Kovo therefore keeps both effects outside
 * the finite authored output surface. Static aliases/spreads are inspected from parser-owned wire
 * facts; an opaque meta spread closes because it could mint the forbidden pair.
 */
function validateDocumentNavigationElements(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
): CompilerDiagnostic[] {
  if (element.intrinsicTagName === 'base') {
    return [
      documentNavigationDiagnostic(
        diagnostics,
        element,
        '<base> is disabled because it changes document-wide relative URL resolution',
        [
          'Fixes: configure the deployment/router base through Kovo and emit root-relative application URLs.',
          'Escape: there is no app-authored <base> suppression.',
        ],
      ),
    ];
  }
  if (element.intrinsicTagName !== 'meta') return [];

  const attributes = element.attributes;
  const attributeLength = compilerArrayLength(attributes, 'Meta navigation attributes');
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = outputArrayValue(attributes, index, 'Meta navigation attributes');
    const issue = metaRefreshAttributeIssue(attribute);
    if (issue === undefined) continue;
    return [documentNavigationDiagnostic(diagnostics, element, issue, metaRefreshFixes)];
  }

  const spreads = element.spreadAttributes;
  const spreadLength = compilerArrayLength(spreads, 'Meta navigation spreads');
  for (let index = 0; index < spreadLength; index += 1) {
    const spread = outputArrayValue(spreads, index, 'Meta navigation spreads');
    if (spread.staticWireAttributeEntries !== undefined) {
      const entries = spread.staticWireAttributeEntries;
      const entryLength = compilerArrayLength(entries, 'Static meta navigation spread entries');
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = outputArrayValue(
          entries,
          entryIndex,
          'Static meta navigation spread entries',
        );
        const issue = metaRefreshWireEntryIssue(entry);
        if (issue !== undefined) {
          return [documentNavigationDiagnostic(diagnostics, element, issue, metaRefreshFixes)];
        }
      }
      continue;
    }
    if (spread.objectEntries !== undefined) {
      const entries = spread.objectEntries;
      const entryLength = compilerArrayLength(entries, 'Meta navigation spread entries');
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = outputArrayValue(entries, entryIndex, 'Meta navigation spread entries');
        const folded = compilerStringToLowerCase(entry.key);
        if (folded !== 'http-equiv' && folded !== 'httpequiv') continue;
        const value = staticSpreadAttributeValue(entry);
        if (value.kind === 'unknown' || metaRefreshValue(value)) {
          return [
            documentNavigationDiagnostic(
              diagnostics,
              element,
              value.kind === 'unknown'
                ? 'an unproved meta http-equiv spread could create refresh navigation'
                : 'meta refresh is disabled because its content is an executable navigation sink',
              metaRefreshFixes,
            ),
          ];
        }
      }
      continue;
    }
    // Opaque spreads are reconstructed by kovoSafeJsxSpread and classified by the server's
    // element-aware pair sink. This is one of the inherently runtime facts assigned to the real
    // sink by SPEC §6.6; do not guess at its keys here.
  }
  return [];
}

/**
 * SPEC §4.8 / §5.2 rule 10: a URL scheme is not the complete security context for elements that
 * execute fetched bytes or carry an isolation boundary. `script[src]`, stylesheet links, and an
 * iframe's `sandbox` attribute can all become unsafe while every individual string remains a
 * syntactically safe relative/HTTPS value. Keep those decisions in the finite element-context
 * surface and close opaque spreads instead of treating them as ordinary attributes.
 */
function validateElementContextSecuritySinks(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  element: JsxElementModel,
): CompilerDiagnostic[] {
  const tag = element.intrinsicTagName;
  if (tag !== 'script' && tag !== 'link' && tag !== 'iframe') return [];

  const attributes = element.attributes;
  const attributeLength = compilerArrayLength(attributes, 'Element-context attributes');
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = outputArrayValue(attributes, index, 'Element-context attributes');
    const reason = directElementContextSinkIssue(model, tag, attribute);
    if (reason !== undefined) {
      return [elementContextSecurityDiagnostic(diagnostics, element, reason)];
    }
  }

  const spreads = element.spreadAttributes;
  const spreadLength = compilerArrayLength(spreads, 'Element-context spreads');
  for (let index = 0; index < spreadLength; index += 1) {
    const spread = outputArrayValue(spreads, index, 'Element-context spreads');
    if (spread.staticWireAttributeEntries !== undefined) {
      const entries = spread.staticWireAttributeEntries;
      const entryLength = compilerArrayLength(entries, 'Static element-context spread entries');
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = outputArrayValue(
          entries,
          entryIndex,
          'Static element-context spread entries',
        );
        const reason = renderedElementContextSinkIssue(
          tag,
          compilerStringToLowerCase(entry.key),
          staticWireSpreadAttributeValue(entry),
        );
        if (reason !== undefined) {
          return [elementContextSecurityDiagnostic(diagnostics, element, reason)];
        }
      }
      continue;
    }
    if (spread.objectEntries !== undefined) {
      const entries = spread.objectEntries;
      const entryLength = compilerArrayLength(entries, 'Element-context spread entries');
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = outputArrayValue(entries, entryIndex, 'Element-context spread entries');
        const reason = renderedElementContextSinkIssue(
          tag,
          compilerStringToLowerCase(entry.key),
          staticSpreadAttributeValue(entry),
        );
        if (reason !== undefined) {
          return [elementContextSecurityDiagnostic(diagnostics, element, reason)];
        }
      }
      continue;
    }
    return [
      elementContextSecurityDiagnostic(
        diagnostics,
        element,
        `an opaque <${tag}> spread could replace an execution or isolation control`,
      ),
    ];
  }
  return [];
}

function directElementContextSinkIssue(
  model: ComponentModuleModel,
  tag: 'iframe' | 'link' | 'script',
  attribute: JsxAttributeModel,
): string | undefined {
  const dynamicTarget = dynamicAttributeName(attribute);
  const target = compilerStringToLowerCase(dynamicTarget ?? attribute.name);
  const value =
    dynamicTarget === null ? staticDirectAttributeValue(attribute) : ({ kind: 'unknown' } as const);
  if (
    value.kind === 'unknown' &&
    (target === 'src' || target === 'href') &&
    attributeExpressionIsTrustedUrlBrand(model, attribute)
  ) {
    return undefined;
  }
  return renderedElementContextSinkIssue(tag, target, value);
}

function renderedElementContextSinkIssue(
  tag: 'iframe' | 'link' | 'script',
  target: string,
  value: StaticRenderedAttributeValue,
): string | undefined {
  if (value.kind !== 'unknown') return undefined;
  if (tag === 'script' && target === 'src') {
    return 'a dynamic script source can execute same-origin attacker-controlled JavaScript';
  }
  if (tag === 'script' && target === 'type') {
    return 'a dynamic script type can turn an inert data block into executable JavaScript';
  }
  if (tag === 'link' && target === 'href') {
    return 'a dynamic stylesheet URL can apply attacker-controlled CSS';
  }
  if (tag === 'link' && target === 'rel') {
    return 'a dynamic link relationship can turn an inert resource into an active stylesheet';
  }
  if (tag === 'iframe' && target === 'sandbox') {
    return 'a dynamic iframe sandbox value can remove the embedded-document isolation boundary';
  }
  return undefined;
}

function attributeExpressionIsTrustedUrlBrand(
  model: ComponentModuleModel,
  attribute: JsxAttributeModel,
): boolean {
  if (attribute.expressionStart === undefined || attribute.expressionEnd === undefined)
    return false;
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Trusted URL attribute expressions');
  for (let index = 0; index < expressionLength; index += 1) {
    const expression = outputArrayValue(expressions, index, 'Trusted URL attribute expressions');
    if (
      expression.start !== attribute.expressionStart ||
      expression.end !== attribute.expressionEnd
    ) {
      continue;
    }
    const astExpression = expressionAtSpan(
      ts as FrameworkIdentityTypeScript,
      model.sourceFile,
      expression,
    );
    return (
      astExpression !== undefined &&
      ts.isCallExpression(astExpression) &&
      expressionResolvesToTrustedUrlPureBrand(model.sourceFile, astExpression.expression)
    );
  }
  return false;
}

function elementContextSecurityDiagnostic(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  reason: string,
): CompilerDiagnostic {
  return {
    ...diagnostics.at('KV236', {
      start: element.start,
      length: element.openingEnd - element.start,
    }),
    help: compilerArrayJoin(
      [
        `Blocked reason: ${reason}.`,
        'Fixes: keep execution/isolation attributes static; use the real trustedUrl(value, auditedReason) only for a reviewed dynamic script or link URL.',
        'Escape: trustedUrl never suppresses dynamic script type, link rel, or iframe sandbox.',
        'SPEC §4.8 and §5.2 rule 10 require element-aware output contexts to fail closed.',
      ],
      '\n',
    ),
    message: `Unsafe output context requires an explicit trusted Kovo escape hatch. ${reason}`,
  };
}

const metaRefreshFixes = [
  'Fixes: perform navigation through Kovo response/router outcomes, or use ordinary non-refresh metadata with a statically proved http-equiv value.',
  'Escape: there is no app-authored meta-refresh suppression.',
] as const;

function metaRefreshAttributeIssue(attribute: JsxAttributeModel): string | undefined {
  const foldedName = compilerStringToLowerCase(attribute.name);
  if (compilerStringStartsWith(foldedName, 'data-bind:')) {
    const target = compilerStringSlice(foldedName, 'data-bind:'.length);
    return target === 'http-equiv' || target === 'httpequiv'
      ? 'a dynamic meta http-equiv binding could create refresh navigation'
      : undefined;
  }
  if (foldedName === 'data-derive-attr') {
    const target =
      typeof attribute.value === 'string' ? compilerStringToLowerCase(attribute.value) : undefined;
    return target === 'http-equiv' || target === 'httpequiv'
      ? 'a dynamic meta http-equiv derive could create refresh navigation'
      : undefined;
  }
  if (foldedName !== 'http-equiv' && foldedName !== 'httpequiv') return undefined;
  const value = staticDirectAttributeValue(attribute);
  if (value.kind === 'unknown') {
    return 'a dynamic meta http-equiv value could create refresh navigation';
  }
  return metaRefreshValue(value)
    ? 'meta refresh is disabled because its content is an executable navigation sink'
    : undefined;
}

function metaRefreshWireEntryIssue(entry: StaticJsxWireAttributeEntry): string | undefined {
  const folded = compilerStringToLowerCase(entry.key);
  if (folded !== 'http-equiv' && folded !== 'httpequiv') return undefined;
  const value = staticWireSpreadAttributeValue(entry);
  if (value.kind === 'unknown') {
    return 'an unproved meta http-equiv spread could create refresh navigation';
  }
  return metaRefreshValue(value)
    ? 'meta refresh is disabled because its content is an executable navigation sink'
    : undefined;
}

function metaRefreshValue(value: StaticRenderedAttributeValue): boolean {
  return (
    value.kind === 'known' &&
    compilerStringToLowerCase(compilerStringTrim(value.value)) === 'refresh'
  );
}

function documentNavigationDiagnostic(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  reason: string,
  fixes: readonly [string, string],
): CompilerDiagnostic {
  return {
    ...diagnostics.at('KV236', {
      start: element.start,
      length: element.openingEnd - element.start,
    }),
    help: compilerArrayJoin(
      [
        `Blocked reason: ${reason}.`,
        fixes[0],
        fixes[1],
        'SPEC §4.8 and §5.2 rule 10 require security-sensitive browser output contexts to fail closed.',
      ],
      '\n',
    ),
    message: `Unsafe output context requires an explicit trusted Kovo escape hatch. ${reason}`,
  };
}

type StaticRenderedAttributeValue =
  | { kind: 'known'; value: string }
  | { kind: 'omitted' }
  | { kind: 'unknown' };

interface StaticRenderedAttributeState {
  key: string;
  value: StaticRenderedAttributeValue;
}

/**
 * SPEC §13.2/§6.6: prove browser rules whose decision depends on an element's combined
 * attributes. JSX spreads apply in source order to a case-sensitive JS props object, while HTML
 * consumes the first emitted duplicate after ASCII case folding. Reconstruct only this narrow
 * `type`/`name` state from parser-owned facts; an opaque spread or dynamic effective value defers
 * to the runtime sink rather than manufacturing a static proof.
 */
function validateCrossAttributeWireSemantics(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
): CompilerDiagnostic[] {
  if (element.intrinsicTagName !== 'input') return [];
  const values = staticEffectiveInputWireAttributes(element);
  if (values === undefined) return [];
  const issue = htmlElementWireValueIssue('input', values.type, values.name);
  if (issue === undefined) return [];
  return [
    {
      ...diagnostics.at('KV236', {
        start: element.start,
        length: element.openingEnd - element.start,
      }),
      help: [
        'Blocked reason: HTML reserves an ASCII-case-insensitive `_charset_` name on hidden inputs and replaces its submitted value with the selected encoding label.',
        'Fixes: rename the field, or use a non-hidden ordinary `_charset_` control only when its authored value is intentional business input.',
        'SPEC §13.2 requires hidden submitted identity to remain the same string; SPEC §6.6 requires the browser sink to fail closed.',
        'Escape: there is no suppression for a browser-reserved submitted control.',
      ].join('\n'),
      message: `Unsafe server HTML wire value in <input> attributes (${issue}); native form construction would replace the authored hidden value.`,
    },
  ];
}

function staticEffectiveInputWireAttributes(
  element: JsxElementModel,
): { name?: string; type?: string } | undefined {
  const states: StaticRenderedAttributeState[] = [];
  let attributeIndex = 0;
  let spreadIndex = 0;
  const attributeLength = compilerArrayLength(element.attributes, 'Input wire attributes');
  const spreadLength = compilerArrayLength(element.spreadAttributes, 'Input wire spreads');

  while (attributeIndex < attributeLength || spreadIndex < spreadLength) {
    const attribute =
      attributeIndex < attributeLength
        ? outputArrayValue(element.attributes, attributeIndex, 'Input wire attributes')
        : undefined;
    const spread =
      spreadIndex < spreadLength
        ? outputArrayValue(element.spreadAttributes, spreadIndex, 'Input wire spreads')
        : undefined;
    if (attribute !== undefined && (spread === undefined || attribute.start < spread.start)) {
      setStaticRenderedAttribute(states, attribute.name, staticDirectAttributeValue(attribute));
      attributeIndex += 1;
      continue;
    }
    if (spread === undefined) break;
    if (spread.staticWireAttributeEntries !== undefined) {
      const entryLength = compilerArrayLength(
        spread.staticWireAttributeEntries,
        'Static input wire spread entries',
      );
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = outputArrayValue(
          spread.staticWireAttributeEntries,
          entryIndex,
          'Static input wire spread entries',
        );
        setStaticRenderedAttribute(states, entry.key, staticWireSpreadAttributeValue(entry));
      }
      spreadIndex += 1;
      continue;
    }
    if (spread.objectEntries === undefined) return undefined;
    const legacyEntryLength = compilerArrayLength(
      spread.objectEntries,
      'Input wire spread entries',
    );
    for (let entryIndex = 0; entryIndex < legacyEntryLength; entryIndex += 1) {
      const entry = outputArrayValue(spread.objectEntries, entryIndex, 'Input wire spread entries');
      setStaticRenderedAttribute(states, entry.key, staticSpreadAttributeValue(entry));
    }
    spreadIndex += 1;
  }

  const type = effectiveStaticRenderedAttribute(states, 'type');
  const name = effectiveStaticRenderedAttribute(states, 'name');
  if (type.kind === 'unknown' || name.kind === 'unknown') return undefined;
  return {
    ...(name.kind === 'known' ? { name: name.value } : {}),
    ...(type.kind === 'known' ? { type: type.value } : {}),
  };
}

function staticDirectAttributeValue(attribute: JsxAttributeModel): StaticRenderedAttributeValue {
  if (attribute.value !== undefined) return { kind: 'known', value: attribute.value };
  const value = attribute.expressionStaticValue;
  if (value === false || value === null) return { kind: 'omitted' };
  if (typeof value === 'string') return { kind: 'known', value };
  if (value !== undefined) return { kind: 'known', value: '' };
  if (attribute.expression !== undefined) return { kind: 'unknown' };
  return { kind: 'known', value: '' };
}

function staticSpreadAttributeValue(entry: ObjectLiteralEntry): StaticRenderedAttributeValue {
  return entry.staticStringValue === undefined
    ? { kind: 'unknown' }
    : { kind: 'known', value: entry.staticStringValue };
}

function staticWireSpreadAttributeValue(
  entry: StaticJsxWireAttributeEntry,
): StaticRenderedAttributeValue {
  if (entry.value.kind === 'unknown') return { kind: 'unknown' };
  const value = entry.value.value;
  if (value === undefined) return { kind: 'omitted' };
  if (value === false || value === null) return { kind: 'omitted' };
  if (typeof value === 'string') return { kind: 'known', value };
  // A non-string static literal serializes to an empty/JSON/numeric blocker, never either reserved
  // keyword. Keep the exact bytes irrelevant to this narrow tuple classifier.
  return { kind: 'known', value: '' };
}

function setStaticRenderedAttribute(
  states: StaticRenderedAttributeState[],
  key: string,
  value: StaticRenderedAttributeValue,
): void {
  const folded = compilerStringToLowerCase(key);
  if (folded !== 'name' && folded !== 'type') return;
  const length = compilerArrayLength(states, 'Static rendered input attributes');
  for (let index = 0; index < length; index += 1) {
    const state = outputArrayValue(states, index, 'Static rendered input attributes');
    if (state.key !== key) continue;
    state.value = value;
    return;
  }
  compilerArrayAppend(states, { key, value }, 'Static rendered input attributes');
}

function effectiveStaticRenderedAttribute(
  states: readonly StaticRenderedAttributeState[],
  expectedName: 'name' | 'type',
): StaticRenderedAttributeValue {
  const length = compilerArrayLength(states, 'Static effective input attributes');
  for (let index = 0; index < length; index += 1) {
    const state = outputArrayValue(states, index, 'Static effective input attributes');
    if (compilerStringToLowerCase(state.key) !== expectedName) continue;
    if (state.value.kind === 'omitted') continue;
    return state.value;
  }
  return { kind: 'omitted' };
}

function validateWireStableAttribute(
  diagnostics: DiagnosticFactory,
  intrinsicTagName: string | undefined,
  attribute: JsxAttributeModel,
  span: SourceSpan = { end: attribute.end, start: attribute.start },
): CompilerDiagnostic[] {
  if (intrinsicTagName === undefined) return [];
  const posture = htmlAttributeWireValuePosture(intrinsicTagName, attribute.name);
  if (posture === undefined) return [];
  const value = literalAttributeStringValue(attribute);
  if (value === null) return [];
  const issue = htmlWireValueIssue(value, posture);
  return issue === undefined
    ? []
    : [wireIdentityDiagnostic(diagnostics, intrinsicTagName, attribute.name, posture, issue, span)];
}

function validateSubmittedElementText(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  element: JsxElementModel,
): CompilerDiagnostic[] {
  const tag = element.intrinsicTagName;
  if (tag === undefined) return [];
  const posture = htmlTextWireValuePosture(tag, elementHasDefinitelyRenderedValue(element));
  if (posture === undefined) return [];

  const found: CompilerDiagnostic[] = [];
  const children = directChildExpressions(model, element);
  const childLength = compilerArrayLength(children, 'Submitted text child expressions');
  for (let index = 0; index < childLength; index += 1) {
    const child = outputArrayValue(children, index, 'Submitted text child expressions');
    if (typeof child.staticValue !== 'string') continue;
    const issue = htmlWireValueIssue(child.staticValue, posture);
    if (issue === undefined) continue;
    compilerArrayAppend(
      found,
      wireIdentityDiagnostic(diagnostics, tag, 'text', posture, issue, {
        end: child.containerEnd,
        start: child.containerStart,
      }),
      'Submitted text wire diagnostics',
    );
  }
  return found;
}

function elementHasDefinitelyRenderedValue(element: JsxElementModel): boolean {
  const attributes = element.attributes;
  const attributeLength = compilerArrayLength(attributes, 'Submitted text value attributes');
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = outputArrayValue(attributes, index, 'Submitted text value attributes');
    if (compilerStringToLowerCase(attribute.name) !== 'value') continue;
    if (attribute.value !== undefined || attribute.expression === undefined) return true;
    const value = attribute.expressionStaticValue;
    return value !== undefined && value !== null && value !== false;
  }
  return false;
}

function wireIdentityDiagnostic(
  diagnostics: DiagnosticFactory,
  tag: string,
  sink: string,
  posture: HtmlWireValuePosture,
  issue: string,
  span: SourceSpan,
): CompilerDiagnostic {
  return {
    ...diagnostics.at('KV236', { start: span.start, length: span.end - span.start }),
    help: [
      'Blocked reason: UTF-8, HTML parsing, or native form serialization would substitute or canonicalize this server-authored wire value; identity-bearing values can then alias a distinct record or DOM target.',
      'Fixes: remove NUL and lone UTF-16 surrogates; use line-ending-free control names and identity-bearing single-line/hidden values. Multiline textarea business content may retain CR/LF. Give options an explicit stable value when their label needs formatting whitespace.',
      'SPEC §13.2 requires rendered, submitted, morph, and optimistic identity to remain the same string.',
      'Escape: there is no suppression; encode display copy separately from identity-bearing fields.',
    ].join('\n'),
    message: `Unsafe server HTML wire value in <${tag}> ${sink} (${posture}: ${issue}); the browser would observe a different string.`,
  };
}

/**
 * SPEC §4.8 / §5.2 #10 (KV236, P2-1): validate the static literal sink entries of a primitive
 * composition `attrs={{…}}` bag on a component-tag element. The merge channel only fires for
 * component tags (`isComponentTag`) and inline object literals (`expressionObjectEntries`), so we
 * gate on exactly that to avoid flagging a plain element's unrelated `attrs` attribute while still
 * closing the merge-channel bypass for every sink the direct/spread forms catch.
 */
function validatePrimitiveAttrsEntries(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  hasExternalEscape: boolean,
): CompilerDiagnostic[] {
  if (!isComponentTag(element.tag)) return [];

  const found: CompilerDiagnostic[] = [];
  const length = compilerArrayLength(element.attributes, 'Primitive attrs attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = outputArrayValue(element.attributes, index, 'Primitive attrs attributes');
    if (attribute.name !== 'attrs' || !attribute.expressionObjectEntries) continue;
    appendOutputItems(
      found,
      validateStaticObjectEntrySinks(
        diagnostics,
        attribute.expressionObjectEntries,
        { end: attribute.end, start: attribute.start },
        hasExternalEscape,
        undefined,
        true,
      ),
      'Primitive attrs entry diagnostics',
    );
  }
  return found;
}

/**
 * SPEC §4.8 (KV236, A3 / P2-1): validate each entry of a static object — a `{...{…}}` spread or a
 * primitive-composition `attrs={{…}}` bag — as if it were a directly authored attribute. Only
 * literal (non-dynamic) string values are statically decidable here; a dynamic value flows through
 * the binding/derive sinks gated elsewhere. The synthesized attribute reuses the existing per-sink
 * validators (URL scheme, style/CSS-url, raw-HTML, on*, srcdoc) so the object-spread, attrs-merge,
 * and direct forms cannot diverge. Fail-closed: an unrecognized key is ignored, a non-literal value
 * is deferred, and every recognized sink reuses the direct path's validator verbatim.
 */
function validateStaticObjectEntrySinks(
  diagnostics: DiagnosticFactory,
  entries: readonly ObjectLiteralEntry[],
  span: SourceSpan,
  hasExternalEscape: boolean,
  intrinsicTagName?: string,
  descendIntoPrimitiveAttrs = false,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const length = compilerArrayLength(entries, 'Static object sink entries');
  for (let index = 0; index < length; index += 1) {
    const entry = outputArrayValue(entries, index, 'Static object sink entries');
    if (
      descendIntoPrimitiveAttrs &&
      compilerStringToLowerCase(entry.key) === 'attrs' &&
      entry.objectEntries !== undefined
    ) {
      appendOutputItems(
        found,
        validateStaticObjectEntrySinks(
          diagnostics,
          entry.objectEntries,
          span,
          hasExternalEscape,
          intrinsicTagName,
          true,
        ),
        'Nested static object sink diagnostics',
      );
      continue;
    }
    if (entry.value === undefined) continue;
    const literal = entry.staticStringValue ?? literalStringValue(entry.value);
    if (literal === null) continue;
    const synthetic: JsxAttributeModel = {
      end: span.end,
      leadingStart: span.start,
      name: entry.key,
      start: span.start,
      value: literal,
    };

    appendOutputItems(
      found,
      validateWireStableAttribute(diagnostics, intrinsicTagName, synthetic, span),
      'Static wire-stable spread diagnostics',
    );

    const generatedControlTarget = dynamicGeneratedControlPlaneTarget(synthetic);
    if (generatedControlTarget !== null) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(
          diagnostics,
          `${synthetic.name} dynamically targets compiler-generated control-plane attribute "${generatedControlTarget}"`,
          { start: span.start, length: span.end - span.start },
        ),
        'Static generated-control diagnostics',
      );
      continue;
    }

    if (isUrlAttribute(synthetic.name)) {
      appendOutputItems(
        found,
        validateUrlAttribute(diagnostics, synthetic, hasExternalEscape),
        'Static URL sink diagnostics',
      );
      continue;
    }
    // SPEC §4.8 / §5.2 #10 (KV236, S4): a synthesized `style` entry is a CSS sink exactly like a
    // direct `style="…"`; route it through the same static CSS-url check (`validateStaticCssText`)
    // so `{...{ style: "background:url('javascript:…')" }}` cannot bypass the direct form's gate.
    if (synthetic.name === 'style') {
      appendOutputItems(
        found,
        validateStyleAttribute(diagnostics, synthetic),
        'Static style sink diagnostics',
      );
      continue;
    }
    if (isRawHtmlAttribute(synthetic.name)) {
      appendOutputItems(
        found,
        validateRawHtmlAttribute(diagnostics, synthetic),
        'Static raw HTML sink diagnostics',
      );
      continue;
    }
    // SPEC §4.8 / §5.2 #10 (KV236): use the direct path's exact event-handler predicate
    // (`isDirectHtmlEventHandlerAttribute`, `/^on[a-z]/`) so the synthesized form flags a raw
    // `onclick`/`onerror` HTML sink while leaving Kovo's `on:click` binding ref and JSX-style
    // `onClick` untouched — identical accept/reject set to a directly-authored attribute.
    if (isDirectHtmlEventHandlerAttribute(synthetic)) {
      compilerArrayAppend(
        found,
        outputContextDiagnostic(
          diagnostics,
          `${synthetic.name} is an event-handler sink (on* attribute)`,
          {
            start: span.start,
            length: span.end - span.start,
          },
        ),
        'Static spread diagnostics',
      );
      continue;
    }
    if (synthetic.name === 'srcdoc') {
      appendOutputItems(
        found,
        validateRawHtmlAttribute(diagnostics, synthetic),
        'Static srcdoc sink diagnostics',
      );
      continue;
    }
  }
  return found;
}

/**
 * SPEC §5.2: component-tag predicate matching the primitive-composition lowering
 * (`primitive-composition.ts` `isComponentTag`): a dotted member tag (`Tooltip.Trigger`) or an
 * uppercase-initial tag (`Menu`) is a component, never a plain HTML element.
 */
function isComponentTag(tag: string): boolean {
  return compilerStringIncludes(tag, '.') || compilerRegExpTest(/^[A-Z]/, tag);
}

function spanContainsAttribute(
  spans: readonly SourceSpan[],
  attribute: JsxAttributeModel,
): boolean {
  const length = compilerArrayLength(spans, 'Compiler-owned style spans');
  for (let index = 0; index < length; index += 1) {
    const span = compilerOwnDataValue(spans, index, 'Compiler-owned style spans') as
      | SourceSpan
      | undefined;
    if (!span) {
      throw new TypeError(`Compiler-owned style spans[${index}] must be an own source span.`);
    }
    if (attribute.start >= span.start && attribute.end <= span.end) return true;
  }
  return false;
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
        `${attribute.name}=${outputJsonString(value)} uses an unsafe URL scheme`,
        { start: attribute.start, length: attribute.end - attribute.start },
      ),
    ];
  }

  if (isExternalHttpUrl(value) && !hasExternalEscape) {
    return [
      outputContextDiagnostic(
        diagnostics,
        `${attribute.name}=${outputJsonString(value)} is an external literal URL without external`,
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
  if (attribute.expressionObjectEntries) {
    return validateStaticStyleObjectAttribute(diagnostics, attribute.expressionObjectEntries, {
      start: attribute.start,
      end: attribute.end,
    });
  }

  return [
    outputContextDiagnostic(diagnostics, 'dynamic style text', {
      start: attribute.start,
      length: attribute.end - attribute.start,
    }),
  ];
}

function validateStaticStyleObjectAttribute(
  diagnostics: DiagnosticFactory,
  entries: readonly ObjectLiteralEntry[],
  span: SourceSpan,
): CompilerDiagnostic[] {
  const length = compilerArrayLength(entries, 'Static style object entries');
  for (let index = 0; index < length; index += 1) {
    const entry = outputArrayValue(entries, index, 'Static style object entries');
    if (entry.objectEntries) continue;
    if (entry.value === undefined) continue;
    const literal = entry.staticStringValue ?? literalStringValue(entry.value);
    if (literal === null || !cssTextHasUnsafeUrl(literal)) continue;
    return [
      outputContextDiagnostic(diagnostics, 'style attribute contains an unsafe CSS url()', {
        start: span.start,
        length: span.end - span.start,
      }),
    ];
  }
  return [];
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

  const componentLength = compilerArrayLength(model.components, 'Component CSS components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = outputArrayValue(
      model.components,
      componentIndex,
      'Component CSS components',
    );
    const optionLength = compilerArrayLength(component.options, 'Component CSS options');
    for (let optionIndex = 0; optionIndex < optionLength; optionIndex += 1) {
      const option = outputArrayValue(component.options, optionIndex, 'Component CSS options');
      if (option.key !== 'css' && option.key !== 'styles') continue;
      if (!option.staticTemplateValue || !cssTextHasUnsafeUrl(option.staticTemplateValue)) continue;

      compilerArrayAppend(
        found,
        outputContextDiagnostic(diagnostics, `${option.key} contains an unsafe CSS url()`),
        'Component CSS diagnostics',
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
  const normalizedAttributeName = compilerStringToLowerCase(attribute.name);
  if (compilerStringStartsWith(normalizedAttributeName, 'data-bind:')) {
    return compilerStringSlice(normalizedAttributeName, 'data-bind:'.length);
  }
  if (normalizedAttributeName === 'data-derive-attr' && typeof attribute.value === 'string') {
    return compilerStringToLowerCase(attribute.value);
  }
  return null;
}

/** Returns the normalized generated-only target of one dynamic binding, when present. */
function dynamicGeneratedControlPlaneTarget(attribute: JsxAttributeModel): string | null {
  const name = dynamicAttributeName(attribute);
  return name !== null && isGeneratedOnlySemanticAttribute(name) ? name : null;
}

/** Returns true when the attribute dynamically targets an on* event-handler sink. */
function isDynamicEventHandlerAttribute(attribute: JsxAttributeModel): boolean {
  const name = dynamicAttributeName(attribute);
  return name !== null && compilerRegExpTest(/^on/i, name);
}

/** Returns true for direct HTML event attributes such as `onclick`, excluding JSX `onClick`. */
function isDirectHtmlEventHandlerAttribute(attribute: JsxAttributeModel): boolean {
  return compilerRegExpTest(/^on[a-z]/, attribute.name);
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

function isExternalHttpUrl(value: string): boolean {
  return compilerRegExpTest(/^https?:\/\//i, value);
}

function cssTextHasUnsafeUrl(cssText: string): boolean {
  const values = cssUrlValues(cssText);
  const length = compilerArrayLength(values, 'CSS url values');
  for (let index = 0; index < length; index += 1) {
    const value = outputArrayValue(values, index, 'CSS url values');
    if (hasUnsafeUrlScheme(value)) return true;
  }

  return false;
}

function cssUrlValues(cssText: string): string[] {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < cssText.length) {
    const urlIndex = compilerStringIndexOf(compilerStringToLowerCase(cssText), 'url(', cursor);
    if (urlIndex === -1) break;
    let index = urlIndex + 'url('.length;
    while (index < cssText.length && compilerRegExpTest(/\s/, cssText[index] ?? '')) {
      index += 1;
    }

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

    compilerArrayAppend(
      values,
      compilerStringTrim(compilerStringSlice(cssText, start, index)),
      'CSS URL values',
    );
    cursor = compilerStringIndexOf(cssText, ')', index);
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

function outputJsonString(value: string): string {
  const encoded = compilerJsonStringify(value);
  if (encoded === undefined) throw new TypeError('Output-context string could not be encoded.');
  return encoded;
}

function outputArrayValue<Value>(values: readonly Value[], index: number, label: string): Value {
  const value = compilerOwnDataValue(values, index, label);
  if (value === undefined) throw new TypeError(`${label}[${index}] must be dense own data.`);
  return value as Value;
}

function appendOutputItems<Value>(output: Value[], values: readonly Value[], label: string): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    compilerArrayAppend(output, outputArrayValue(values, index, label), label);
  }
}
