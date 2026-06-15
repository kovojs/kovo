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
import type { CompileComponentOptions, StateDeriveFact } from '../types.js';

type InlineDeriveLoweringOptions = Pick<
  CompileComponentOptions,
  'fileName' | 'queryShapeFacts' | 'queryShapes' | 'registryFacts' | 'source'
>;

interface InlineAttributeDerive {
  attribute: JsxAttributeModel;
  baseName: string;
  expression: string;
  query: string;
  source: 'query' | 'state';
}

interface InlineStateTextDerive {
  baseName: string;
  end?: number;
  expression: string;
  start?: number;
}

interface InlineAttributeDeriveLowering {
  prefix: string;
  replacements: SourceReplacement[];
  stateDerives: StateDeriveFact[];
}

export function lowerInlineAttributeDerives(
  model: ComponentModuleModel,
  componentName: string,
  options: InlineDeriveLoweringOptions,
): InlineAttributeDeriveLowering {
  const knownQueries = knownQueryNames(model, options);

  const replacements: SourceReplacement[] = [];
  const deriveExports: string[] = [];
  const stateDerives: StateDeriveFact[] = [];
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

    const loweredCandidates =
      candidates.length === 1
        ? candidates
        : candidates.every((item) => item.source === 'state')
          ? candidates
          : [];
    for (const candidate of loweredCandidates) {
      const exportName = nextExportName(candidate.baseName, nameCounts);
      const stampName = `${candidate.query}.${exportName}`;
      const expression =
        candidate.source === 'state'
          ? deriveExpression(candidate.attribute, candidate.expression)
          : candidate.expression.trim();

      deriveExports.push(
        `export const ${exportName} = derive([${JSON.stringify(candidate.query)}], (${candidate.query}) => ${expression});`,
      );
      if (candidate.source === 'state') {
        stateDerives.push({
          attr: candidate.attribute.name,
          expression,
          exportName,
          input: 'state',
          name: exportName,
          param: 'state',
          placeholder: stampName,
        });
      }
      replacements.push({
        end: candidate.attribute.end,
        replacement:
          candidate.source === 'state'
            ? `${stateBindingAttributeName(candidate.attribute.name)}="${escapeAttribute(stampName)}"`
            : `data-derive="${escapeAttribute(stampName)}" data-derive-attr="${escapeAttribute(candidate.attribute.name)}"`,
        start: candidate.attribute.start,
      });
    }
  }

  for (const element of jsxElements(model)) {
    const binding = inlineTextBinding(element, model, knownQueries);
    if (binding) {
      replacements.push({
        end: element.openingEnd - 1,
        replacement: ` data-bind="${escapeAttribute(binding)}"`,
        start: element.openingEnd - 1,
      });
      continue;
    }

    const derive = inlineTextDerive(element, model, componentName);
    if (!derive) continue;

    const exportName = nextExportName(derive.baseName, nameCounts);
    const stampName = `state.${exportName}`;
    recordStateDerive(derive, exportName, stampName, deriveExports, stateDerives);

    replacements.push({
      end: element.openingEnd - 1,
      replacement: ` data-bind="${escapeAttribute(stampName)}"`,
      start: element.openingEnd - 1,
    });
  }

  for (const expression of jsxExpressions(model)) {
    const binding = inlineMixedTextBinding(expression, model, knownQueries);
    if (binding) {
      replacements.push({
        end: binding.end,
        replacement: `<span data-bind="${escapeAttribute(binding.path)}">{${binding.path}}</span>`,
        start: binding.start,
      });
      continue;
    }

    const derive = inlineMixedTextDerive(expression, model, componentName);
    if (!derive) continue;

    const exportName = nextExportName(derive.baseName, nameCounts);
    const stampName = `state.${exportName}`;
    recordStateDerive(derive, exportName, stampName, deriveExports, stateDerives);

    replacements.push({
      end: derive.end ?? expression.containerEnd,
      replacement: `<span data-bind="${escapeAttribute(stampName)}">{${derive.expression}}</span>`,
      start: derive.start ?? expression.containerStart,
    });
  }

  if (replacements.length === 0) {
    return {
      prefix: '',
      replacements,
      stateDerives,
    };
  }

  const prefix = `import { derive } from '@jiso/runtime';\n\n${deriveExports.join('\n')}\n\n`;
  if (deriveExports.length > 0) {
    const start = derivePrefixInsertionOffset(options.source);
    replacements.push({
      end: start,
      replacement: prefix,
      start,
    });
  }

  return {
    prefix: '',
    replacements,
    stateDerives,
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
  const roots = new Set(
    (attribute.expressionPropertyAccesses ?? [])
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  const stateOnly = roots.size > 0 && [...roots].every((root) => root === 'state');
  if (queryRoots.size !== 1 && !stateOnly) return null;
  if (queryRoots.size > 0 && roots.has('state')) return null;

  const query = stateOnly ? 'state' : [...queryRoots][0];
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attribute.name)}_derive`,
    expression: attribute.expression.trim(),
    query,
    source: stateOnly ? 'state' : 'query',
  };
}

function recordStateDerive(
  derive: InlineStateTextDerive,
  exportName: string,
  stampName: string,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
): void {
  const expression = derive.expression.trim();
  deriveExports.push(`export const ${exportName} = derive(["state"], (state) => ${expression});`);
  stateDerives.push({
    expression,
    exportName,
    input: 'state',
    name: exportName,
    param: 'state',
    placeholder: stampName,
  });
}

function nextExportName(baseName: string, nameCounts: Map<string, number>): string {
  const count = nameCounts.get(baseName) ?? 0;
  nameCounts.set(baseName, count + 1);
  return count === 0 ? baseName : `${baseName}_${count + 1}`;
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

  return queryPathUsesKnownQuery(expression, knownQueries) || isStatePath(expression)
    ? expression
    : null;
}

function inlineTextDerive(
  element: JsxElementModel,
  model: ComponentModuleModel,
  componentName: string,
): InlineStateTextDerive | null {
  if (element.selfClosing) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;

  const expression = soleJsxExpressionChild(element, model);
  if (!expression || expression.solePropertyAccessPath) return null;
  if (!isStateOnlyExpression(expression.propertyAccesses)) return null;

  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: expression.expression,
  };
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

function inlineMixedTextDerive(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
  componentName: string,
): InlineStateTextDerive | null {
  if (!isStateOnlyExpression(expression.propertyAccesses)) return null;
  if (isJsxAttributeExpression(expression, model)) return null;

  const element = innermostContainingElement(expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (inlineTextBinding(element, model, new Set()) !== null) return null;
  if (inlineTextDerive(element, model, componentName) !== null) return null;

  const start = expression.containerStart;
  const end = expression.containerEnd;
  if (start === -1 || end === -1 || start < element.openingEnd || end > element.closingStart) {
    return null;
  }

  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    end,
    expression: expression.expression,
    start,
  };
}

function soleKnownQueryPath(
  expression: JsxExpressionModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  const path = expression.solePropertyAccessPath ?? null;
  if (!path) return null;

  return queryPathUsesKnownQuery(path, knownQueries) || isStatePath(path) ? path : null;
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

function isStateOnlyExpression(paths: readonly { path: string }[]): boolean {
  const roots = new Set(
    paths.map((path) => queryNameFromPath(path.path)).filter((root): root is string => root !== null),
  );
  return roots.size > 0 && [...roots].every((root) => root === 'state');
}

function derivePrefixInsertionOffset(source: string): number {
  const jsxImportSource = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  return jsxImportSource?.[0].length ?? 0;
}

function stateBindingAttributeName(name: string): string {
  return `data-bind:${name}`;
}

function deriveExpression(attribute: JsxAttributeModel, expression: string): string {
  const trimmed = expression.trim();
  return booleanPresenceAttributes.has(attribute.name) ? `((${trimmed}) ? "" : null)` : trimmed;
}

const booleanPresenceAttributes = new Set([
  'checked',
  'disabled',
  'hidden',
  'multiple',
  'open',
  'readonly',
  'required',
  'selected',
]);

function isStatePath(path: string): boolean {
  return path.startsWith('state.');
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
