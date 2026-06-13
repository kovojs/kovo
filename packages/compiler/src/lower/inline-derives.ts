import {
  jsxElements,
  jsxExpressions,
  soleJsxExpressionChild,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type JsxExpressionModel,
} from '../scan/parse.js';
import {
  knownQueryNames,
  queryNameFromPath,
  queryPathUsesKnownQuery,
} from '../analyze/query-shapes.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';
import type { CompileComponentOptions } from '../types.js';

type InlineDeriveLoweringOptions = Pick<
  CompileComponentOptions,
  'fileName' | 'queryShapeFacts' | 'queryShapes' | 'registryFacts'
>;

interface InlineAttributeDerive {
  attribute: JsxAttributeModel;
  baseName: string;
  expression: string;
  query: string;
}

interface InlineAttributeDeriveLowering {
  prefix: string;
  replacements: SourceReplacement[];
}

export function lowerInlineAttributeDerives(
  model: ComponentModuleModel,
  componentName: string,
  options: InlineDeriveLoweringOptions,
): InlineAttributeDeriveLowering {
  const knownQueries = knownQueryNames(model, options);
  if (knownQueries.size === 0) {
    return {
      prefix: '',
      replacements: [],
    };
  }

  const replacements: SourceReplacement[] = [];
  const deriveExports: string[] = [];
  const nameCounts = new Map<string, number>();

  for (const element of jsxElements(model)) {
    if (
      element.attributes.some((attribute) =>
        ['data-derive', 'data-derive-attr'].includes(attribute.name),
      )
    ) {
      continue;
    }

    const candidates = element.attributes
      .map((attribute) => inlineAttributeDerive(attribute, element, componentName, knownQueries))
      .filter((candidate): candidate is InlineAttributeDerive => candidate !== null);

    const candidate = candidates[0];
    if (!candidate || candidates.length !== 1) continue;
    const count = nameCounts.get(candidate.baseName) ?? 0;
    nameCounts.set(candidate.baseName, count + 1);
    const exportName = count === 0 ? candidate.baseName : `${candidate.baseName}_${count + 1}`;
    const stampName = `${candidate.query}.${exportName}`;

    deriveExports.push(
      `export const ${exportName} = derive([${JSON.stringify(candidate.query)}], (${candidate.query}) => ${candidate.expression});`,
    );
    replacements.push({
      end: candidate.attribute.end,
      replacement: `data-derive="${escapeAttribute(stampName)}" data-derive-attr="${escapeAttribute(candidate.attribute.name)}"`,
      start: candidate.attribute.start,
    });
  }

  for (const element of jsxElements(model)) {
    const binding = inlineTextBinding(element, model, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: element.openingEnd - 1,
      replacement: ` data-bind="${escapeAttribute(binding)}"`,
      start: element.openingEnd - 1,
    });
  }

  for (const expression of jsxExpressions(model)) {
    const binding = inlineMixedTextBinding(expression, model, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: binding.end,
      replacement: `<span data-bind="${escapeAttribute(binding.path)}">{${binding.path}}</span>`,
      start: binding.start,
    });
  }

  if (replacements.length === 0) {
    return {
      prefix: '',
      replacements,
    };
  }

  const prefix = `${deriveExports.join('\n')}\n\n`;

  return {
    prefix,
    replacements,
  };
}

function inlineAttributeDerive(
  attribute: JsxAttributeModel,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  if (shouldSkipInlineAttributeDerive(attribute)) return null;

  const queryRoots = new Set(
    (attribute.expressionPropertyAccesses ?? [])
      .map((path) => queryNameFromPath(path.path))
      .filter((query): query is string => query !== null && knownQueries.has(query)),
  );
  if (queryRoots.size !== 1) return null;

  const query = [...queryRoots][0];
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attribute.name)}_derive`,
    expression: attribute.expression.trim(),
    query,
  };
}

function shouldSkipInlineAttributeDerive(attribute: JsxAttributeModel): boolean {
  const { name } = attribute;
  return (
    attribute.domEventName !== undefined ||
    attribute.executionTriggerName !== undefined ||
    name === 'className' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name === 'data-bind' ||
    name.startsWith('data-bind:') ||
    name.startsWith('data-p-') ||
    name.startsWith('fw-')
  );
}

function inlineTextBinding(
  element: JsxElementModel,
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  if (element.selfClosing) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;

  const expression = soleJsxExpressionChild(element, model)?.solePropertyAccessPath ?? null;
  if (!expression) return null;

  return queryPathUsesKnownQuery(expression, knownQueries) ? expression : null;
}

function inlineMixedTextBinding(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): { end: number; path: string; start: number } | null {
  const path = soleKnownQueryPath(expression, knownQueries);
  if (!path) return null;
  if (isJsxAttributeExpression(expression, model)) return null;

  const element = innermostContainingElement(expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (inlineTextBinding(element, model, knownQueries) !== null) return null;

  const start = expression.containerStart;
  const end = expression.containerEnd;
  if (start === -1 || end === -1 || start < element.openingEnd || end > element.closingStart) {
    return null;
  }

  return { end, path, start };
}

function soleKnownQueryPath(
  expression: JsxExpressionModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  const path = expression.solePropertyAccessPath ?? null;
  if (!path) return null;

  return queryPathUsesKnownQuery(path, knownQueries) ? path : null;
}

function isJsxAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  return jsxElements(model).some((element) =>
    element.attributes.some(
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    ),
  );
}

function innermostContainingElement(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): JsxElementModel | null {
  return (
    jsxElements(model)
      .filter(
        (element) =>
          !element.selfClosing &&
          expression.start >= element.openingEnd &&
          expression.end <= element.closingStart,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
}

function isBindingAttributeName(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:') || name === 'data-bind-list';
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
