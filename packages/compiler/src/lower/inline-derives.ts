import {
  componentOptionObjectKeys,
  jsxElements,
  jsxExpressions,
  propertyAccessPaths,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  applySourceReplacements,
  escapeAttribute,
  identitySourceOffsetMap,
  prefixedSourceOffsetMap,
  type SourceOffsetMap,
  type SourceReplacement,
} from '../shared.js';

interface InlineDeriveLoweringOptions {
  fileName: string;
  queryShapeFacts?: readonly { query: string }[];
  queryShapes?: Record<string, unknown>;
  registryFacts?: {
    queries?: Record<string, unknown>;
  };
}

interface InlineAttributeDerive {
  attribute: JsxAttributeModel;
  baseName: string;
  expression: string;
  query: string;
}

export function lowerInlineAttributeDerives(
  source: string,
  model: ComponentModuleModel,
  componentName: string,
  options: InlineDeriveLoweringOptions,
): { diagnosticSource: string; source: string; sourceOffsetMap: SourceOffsetMap } {
  const knownQueries = new Set([
    ...componentOptionObjectKeys(model, 'queries'),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(options.queryShapes ?? {}),
    ...(options.queryShapeFacts ?? []).map((fact) => fact.query),
  ]);
  if (knownQueries.size === 0) {
    return {
      diagnosticSource: source,
      source,
      sourceOffsetMap: identitySourceOffsetMap(source.length),
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
    const binding = inlineTextBinding(element, source, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: element.openingEnd - 1,
      replacement: ` data-bind="${escapeAttribute(binding)}"`,
      start: element.openingEnd - 1,
    });
  }

  for (const expression of jsxExpressions(model)) {
    const binding = inlineMixedTextBinding(expression, model, source, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: binding.end,
      replacement: `<span data-bind="${escapeAttribute(binding.path)}">{${binding.path}}</span>`,
      start: binding.start,
    });
  }

  if (replacements.length === 0) {
    return {
      diagnosticSource: source,
      source,
      sourceOffsetMap: identitySourceOffsetMap(source.length),
    };
  }

  const lowered = applySourceReplacements(source, replacements);
  const prefix = `${deriveExports.join('\n')}\n\n`;

  return {
    diagnosticSource: lowered,
    source: `${prefix}${lowered}`,
    sourceOffsetMap: prefixedSourceOffsetMap(prefix.length, lowered.length),
  };
}

function inlineAttributeDerive(
  attribute: JsxAttributeModel,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  if (shouldSkipInlineAttributeDerive(attribute.name)) return null;

  const paths = propertyAccessPaths('attribute-expression.tsx', attribute.expression);
  const queryRoots = new Set(
    paths
      .map((path) => path.split('.', 1)[0])
      .filter((query): query is string => query !== undefined && knownQueries.has(query)),
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

function shouldSkipInlineAttributeDerive(name: string): boolean {
  return (
    name === 'className' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name === 'data-bind' ||
    name.startsWith('data-bind:') ||
    name.startsWith('data-p-') ||
    name.startsWith('fw-') ||
    name.startsWith('on') ||
    name.startsWith('on:')
  );
}

function inlineTextBinding(
  element: JsxElementModel,
  source: string,
  knownQueries: ReadonlySet<string>,
): string | null {
  if (element.selfClosing) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;

  const content = source.slice(element.openingEnd, element.closingStart);
  const expression = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(
    content,
  )?.groups?.path;
  if (!expression) return null;

  const query = expression.split('.', 1)[0];
  return query && knownQueries.has(query) ? expression : null;
}

function inlineMixedTextBinding(
  expression: { end: number; expression: string; start: number },
  model: ComponentModuleModel,
  source: string,
  knownQueries: ReadonlySet<string>,
): { end: number; path: string; start: number } | null {
  const path = soleKnownQueryPath(expression.expression, knownQueries);
  if (!path) return null;
  if (isJsxAttributeExpression(expression, model)) return null;

  const element = innermostContainingElement(expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (inlineTextBinding(element, source, knownQueries) !== null) return null;

  const start = source.lastIndexOf('{', expression.start);
  const end = source.indexOf('}', expression.end);
  if (start === -1 || end === -1 || start < element.openingEnd || end > element.closingStart) {
    return null;
  }

  return { end: end + 1, path, start };
}

function soleKnownQueryPath(expression: string, knownQueries: ReadonlySet<string>): string | null {
  const path =
    /^(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)$/.exec(expression.trim())?.groups?.path ??
    null;
  if (!path) return null;

  const query = path.split('.', 1)[0];
  return query && knownQueries.has(query) ? path : null;
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
