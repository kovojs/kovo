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
import {
  runtimeOutputHelpers,
  stylePropertyExpression,
} from '../security/output-context.js';
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
  targetAttr: string;
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
  let needsStylePropertyHelper = false;

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

    const useBindingStamp = candidates.length > 1;
    for (const candidate of candidates) {
      const exportName = nextExportName(candidate.baseName, nameCounts);
      const stampName = `${candidate.query}.${exportName}`;
      const expression =
        candidate.source === 'state'
          ? deriveExpression(candidate.attribute, candidate.expression)
          : candidate.expression.trim();
      if (candidate.attribute.name === 'viewTransitionName') needsStylePropertyHelper = true;

      deriveExports.push(
        `export const ${exportName} = derive([${JSON.stringify(candidate.query)}], (${deriveParam(candidate)}) => ${expression});`,
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
            ? stateAttributeBindingReplacement(candidate, stampName, options.source)
            : useBindingStamp
              ? queryAttributeBindingReplacement(candidate, stampName)
              : `data-derive="${escapeAttribute(stampName)}" data-derive-attr="${escapeAttribute(candidate.targetAttr)}"`,
        start: candidate.attribute.start,
      });
    }
  }

  // SECURITY (SECURITY_FINDINGS.md C1): elements that receive a sole-child reactive binding are
  // owned by the data-bind mechanism (the client updates them via textContent), so the C1
  // text-escaping pass leaves their child alone and focuses on static interpolations.
  const boundElementStarts = new Set<number>();
  for (const element of jsxElements(model)) {
    const binding = inlineTextBinding(element, model, knownQueries);
    if (binding) {
      boundElementStarts.add(element.start);
      replacements.push({
        end: element.openingEnd - 1,
        replacement: ` data-bind="${escapeAttribute(binding)}"`,
        start: element.openingEnd - 1,
      });
      continue;
    }

    const derive = inlineTextDerive(element, model, componentName);
    if (!derive) continue;

    boundElementStarts.add(element.start);
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

  const escapeApplied = escapeStaticTextInterpolations(model, replacements, boundElementStarts);

  if (replacements.length === 0) {
    return {
      prefix: '',
      replacements,
      stateDerives,
    };
  }

  // Use the typed named-import facts (SPEC §5.2 parser boundary) rather than scanning raw source to
  // decide whether escapeText is already imported (avoids a duplicate-binding SyntaxError when an
  // author imported it manually). On a recompile escapeApplied is false, so the import is stable.
  const alreadyImportsEscapeText = model.namedImports.some(
    (entry) => entry.importedName === 'escapeText' && entry.moduleSpecifier === '@kovojs/server',
  );
  const escapeImport =
    escapeApplied && !alreadyImportsEscapeText
      ? `import { escapeText } from '@kovojs/server';\n`
      : '';
  const runtimeImports = [
    ...(deriveExports.length > 0 ? ['derive'] : []),
    ...(needsStylePropertyHelper ? [runtimeOutputHelpers.styleProperty] : []),
  ].sort();
  const derivePrefix =
    runtimeImports.length > 0
      ? `import { ${runtimeImports.join(', ')} } from '@kovojs/runtime';\n\n${deriveExports.join('\n')}\n\n`
      : '';
  const prefix = `${escapeImport}${derivePrefix}`;
  if (prefix.length > 0) {
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

// SECURITY (SECURITY_FINDINGS.md C1): the @kovojs/server jsx runtime emits text children verbatim,
// so an app-authored `{data.field}` text interpolation is a stored-XSS sink. During lowering we
// wrap simple data-path text children in escapeText(...) (which mirrors renderJsxChildren's
// null/undefined/boolean/array coercion and HTML-escapes scalar values) so generated components
// are safe by default. Only sole property-access paths are wrapped — never nested JSX elements,
// `.map()`, calls, ternaries, or already-escaped expressions — because solePropertyAccessPath is
// defined only for `a.b`-style expressions. The wrap is idempotent under the fixpoint: its result
// is a call expression, so on a recompile it has no solePropertyAccessPath and is never re-wrapped.
function escapeStaticTextInterpolations(
  model: ComponentModuleModel,
  replacements: SourceReplacement[],
  boundElementStarts: ReadonlySet<number>,
): boolean {
  const consumed = replacements.map((replacement) => ({
    end: replacement.end,
    start: replacement.start,
  }));
  let applied = false;

  for (const element of jsxElements(model)) {
    // Skip elements owned by the reactive data-bind mechanism (sole-child derived bindings or a
    // hand-written data-bind/data-derive stamp): their text is updated client-side via textContent.
    if (boundElementStarts.has(element.start)) continue;
    if (
      element.attributes.some(
        (attribute) =>
          attribute.name === 'data-bind' ||
          attribute.name.startsWith('data-bind:') ||
          attribute.name === 'data-derive' ||
          attribute.name === 'data-derive-attr',
      )
    ) {
      continue;
    }

    for (const container of element.childExpressionContainers) {
      const expression = model.jsxExpressions.find(
        (candidate) =>
          candidate.containerStart === container.start && candidate.containerEnd === container.end,
      );
      // solePropertyAccessPath is defined only for `a.b`-style expressions, never for the
      // escapeText(...) call we emit — so the wrap is inherently idempotent under the fixpoint and
      // needs no raw-source `startsWith` check (which would violate the SPEC §5.2 parser boundary).
      if (!expression || expression.solePropertyAccessPath === undefined) continue;
      if (consumed.some((span) => container.start < span.end && span.start < container.end)) {
        continue;
      }

      replacements.push({
        end: container.end,
        replacement: `{escapeText(${expression.expression})}`,
        start: container.start,
      });
      applied = true;
    }
  }

  return applied;
}

function inlineAttributeDerive(
  attribute: JsxAttributeModel,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  if (attribute.name === 'viewTransitionName') {
    return inlineViewTransitionNameDerive(attribute, element, componentName, knownQueries);
  }
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
    targetAttr: attribute.name,
  };
}

function inlineViewTransitionNameDerive(
  attribute: JsxAttributeModel,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;

  const styleAttribute = element.attributes.find((item) => item.name === 'style');
  const propertyAccesses = [
    ...(attribute.expressionPropertyAccesses ?? []),
    ...(styleAttribute?.expressionPropertyAccesses ?? []),
  ];
  const roots = new Set(
    propertyAccesses
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  const queryRoots = new Set([...roots].filter((query) => knownQueries.has(query)));
  const stateOnly = roots.size > 0 && [...roots].every((root) => root === 'state');
  const queryOnly =
    queryRoots.size === 1 && [...roots].every((root) => root === [...queryRoots][0]);
  const query = stateOnly ? 'state' : queryOnly ? [...queryRoots][0] : null;
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_style_derive`,
    expression: viewTransitionNameStyleExpression(attribute.expression, styleAttribute),
    query,
    source: stateOnly ? 'state' : 'query',
    targetAttr: 'style',
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
  deriveExports.push(
    `export const ${exportName} = derive(["state"], (state: any) => ${expression});`,
  );
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
    name.startsWith('kovo-')
  );
}

function queryAttributeBindingReplacement(
  candidate: InlineAttributeDerive,
  stampName: string,
): string {
  return `${stateBindingAttributeName(candidate.targetAttr)}="${escapeAttribute(stampName)}"`;
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
    paths
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
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

function stateAttributeBindingReplacement(
  candidate: InlineAttributeDerive,
  stampName: string,
  source: string,
): string {
  if (candidate.targetAttr !== candidate.attribute.name) {
    return `${stateBindingAttributeName(candidate.targetAttr)}="${escapeAttribute(stampName)}"`;
  }

  const attributeSource = source.slice(candidate.attribute.start, candidate.attribute.end);

  return `${attributeSource} ${stateBindingAttributeName(candidate.targetAttr)}="${escapeAttribute(stampName)}"`;
}

function deriveParam(candidate: InlineAttributeDerive): string {
  return candidate.source === 'state' ? 'state: any' : candidate.query;
}

function deriveExpression(attribute: JsxAttributeModel, expression: string): string {
  const trimmed = expression.trim();
  return booleanPresenceAttributes.has(attribute.name) ? `((${trimmed}) ? "" : null)` : trimmed;
}

function viewTransitionNameStyleExpression(
  transitionExpression: string,
  styleAttribute: JsxAttributeModel | undefined,
): string {
  const transition = stylePropertyExpression('view-transition-name', transitionExpression);
  if (styleAttribute?.expression !== undefined) {
    return `[${styleAttribute.expression}, ${transition}].filter(Boolean).join('; ')`;
  }

  const existing = (styleAttribute?.value ?? '').trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const prefix = existing === '' ? '' : `${existing}${separator} `;
  return prefix === '' ? transition : `[${JSON.stringify(`${prefix}`)}, ${transition}].join('')`;
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
