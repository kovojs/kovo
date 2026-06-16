import { runInNewContext } from 'node:vm';

import { compilerIrHeader } from '../ir.js';
import {
  componentOptionObjectKeys,
  componentRenderHost,
  componentRenderHostElement,
  componentStateReturnObjectModel,
  firstComponentModel,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, splitDepValue, type SourceReplacement } from '../shared.js';
import {
  emitElementParamTypes,
  type HandlerLowering,
  type RenderEquivalenceCheck,
} from '../types.js';

export interface EmittedServerModule {
  executableSource: string;
  source: string;
}

export function emitServerModule(renderedSource: string): EmittedServerModule {
  return {
    executableSource: renderSourceModule(renderedSource, ''),
    source: renderSourceModule(renderedSource, 'export '),
  };
}

export function serverRenderLowering(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): SourceReplacement[] {
  return serverRenderPatches(handlers, model);
}

export function renderEquivalenceCheck(
  artifact: string,
  expected: string,
  executableSource: string,
): RenderEquivalenceCheck {
  const actual = emittedServerRenderSource(executableSource);

  return {
    actual,
    artifact,
    expected,
    ok: actual === expected,
  };
}

export function renderEquivalenceSourceCheck(
  artifact: string,
  expectedSource: string,
  actualSource: string,
  options: { expectedIgnoredSpans?: readonly RenderEquivalenceIgnoredSpan[] } = {},
): RenderEquivalenceCheck {
  const expected = normalizeRenderEquivalenceSource(
    removeIgnoredSpans(expectedSource, options.expectedIgnoredSpans ?? []),
  );
  const actual = normalizeRenderEquivalenceSource(actualSource);

  return {
    actual,
    artifact,
    expected,
    ok: actual === expected,
  };
}

export interface RenderEquivalenceIgnoredSpan {
  end: number;
  start: number;
}

function removeIgnoredSpans(
  source: string,
  spans: readonly RenderEquivalenceIgnoredSpan[],
): string {
  return [...spans]
    .toSorted((left, right) => right.start - left.start)
    .reduce((next, span) => `${next.slice(0, span.start)}${next.slice(span.end)}`, source);
}

function normalizeRenderEquivalenceSource(source: string): string {
  return source
    .replace(
      /\s+(?:kovo-c|kovo-deps|kovo-state|kovo-param-types|data-p-[\w-]+|on:[\w-]+)=(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+)/g,
      '',
    )
    .replace(/\s+(data-bind(?::[\w-]+)?)(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?/g, ' $1')
    .replace(/\s+on[A-Z][\w-]*=(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([>/])/g, '$1')
    .trim();
}

function emittedServerRenderSource(serverSource: string): string {
  try {
    const actual = runInNewContext(`${serverSource}\n;renderSource();`, {}, { timeout: 1000 });
    return typeof actual === 'string' ? actual : '';
  } catch {
    return '';
  }
}

function serverRenderPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): SourceReplacement[] {
  const host = componentRenderHost(model);
  const patches: SourceReplacement[] = [];
  const chained = chainedPrimitiveHandlerPatches(handlers, model);
  const chainedHandlers = new Set(chained.handlers);
  patches.push(...chained.patches);
  const hostHandlers = host
    ? handlers.filter(
        (handler) => handler.attributeStart >= host.start && handler.attributeEnd <= host.end,
      )
    : [];

  for (const handler of handlers) {
    if (chainedHandlers.has(handler)) continue;
    if (hostHandlers.includes(handler)) continue;
    patches.push({
      end: handler.attributeEnd,
      replacement: handlerAttributeReplacement(handler),
      start: handler.attributeStart,
    });
  }

  if (host) {
    const hostElement = componentRenderHostElement(model);
    if (!hostElement) return patches;

    patches.push(
      ...hostHandlers
        .filter((handler) => !chainedHandlers.has(handler))
        .map(handlerSourceReplacement),
    );
    patches.push(...renderHostStampPatches(model, hostElement));
  }

  return patches;
}

function chainedPrimitiveHandlerPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): { handlers: readonly HandlerLowering[]; patches: readonly SourceReplacement[] } {
  const patches: SourceReplacement[] = [];
  const chainedHandlers: HandlerLowering[] = [];

  for (const element of model.jsxElements) {
    const elementHandlers = handlers.filter(
      (handler) =>
        handler.attributeStart >= element.start && handler.attributeEnd <= element.openingEnd,
    );
    if (elementHandlers.length === 0) continue;

    for (const attribute of element.attributes) {
      if (!attribute.name.startsWith('on:') || !attribute.value) continue;

      const attributeHandlers = elementHandlers.filter(
        (handler) => handler.attributeName === attribute.name,
      );
      if (attributeHandlers.length === 0) continue;

      // SPEC.md §4.6: primitive composition chains on:* refs author-first, then primitive.
      patches.push({
        end: attribute.end,
        replacement: chainedPrimitiveHandlerAttribute(
          attribute.name,
          attribute.value,
          attributeHandlers,
        ),
        start: attribute.start,
      });
      for (const handler of attributeHandlers) {
        patches.push({ end: handler.attributeEnd, replacement: '', start: handler.attributeStart });
        chainedHandlers.push(handler);
      }
    }
  }

  return { handlers: chainedHandlers, patches };
}

function chainedPrimitiveHandlerAttribute(
  name: string,
  primitiveRefs: string,
  handlers: readonly HandlerLowering[],
): string {
  return [
    `${name}="${escapeAttribute(
      [
        ...handlers.map((handler) => handler.attributeValue),
        ...primitiveRefs.split(/\s+/).filter(Boolean),
      ].join(' '),
    )}"`,
    emitElementParamTypes(handlers.flatMap((handler) => handler.params)),
    ...handlers.flatMap((handler) =>
      handler.params.map((param) => `${param.attributeName}="${escapeAttribute(param.value)}"`),
    ),
  ]
    .filter(Boolean)
    .join(' ');
}

function handlerSourceReplacement(handler: HandlerLowering): SourceReplacement {
  return {
    end: handler.attributeEnd,
    replacement: handlerAttributeReplacement(handler),
    start: handler.attributeStart,
  };
}

function handlerAttributeReplacement(handler: HandlerLowering): string {
  return [
    `${handler.attributeName}="${handler.attributeValue}"`,
    emitElementParamTypes(handler.params),
    ...handler.params.map((param) => `${param.attributeName}="${escapeAttribute(param.value)}"`),
  ]
    .filter(Boolean)
    .join(' ');
}

function renderHostStampPatches(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): SourceReplacement[] {
  const patches: SourceReplacement[] = [];
  const insertedAttributes: string[] = [];
  const componentIdentity = componentIdentityStamp(model, hostElement);
  const declaredQueryDeps = declaredQueryDepsStamp(model, hostElement);
  const stateJson = staticStateJson(model);

  if (componentIdentity) insertedAttributes.push(componentIdentity);

  if (declaredQueryDeps) {
    const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-deps');
    if (existing) {
      patches.push({
        end: existing.end,
        replacement: declaredQueryDeps,
        start: existing.start,
      });
    } else {
      insertedAttributes.push(declaredQueryDeps);
    }
  }

  if (stateJson) insertedAttributes.push(`kovo-state="${escapeAttribute(stateJson)}"`);

  if (insertedAttributes.length > 0) {
    const insertion = openingTagAttributeInsertion(hostElement, insertedAttributes);
    patches.push({
      end: insertion.position,
      replacement: insertion.replacement,
      start: insertion.position,
    });
  }

  return patches;
}

// SPEC.md §4.2: component identity is the kovo-c stamp. The compiler omits it
// when the host tag already spells the component name (dashed tags are inert
// sugar) and emits it explicitly on native hosts (`<tr kovo-c="cart-row">`), so
// authored sugar never hand-writes the stamp (§4.8 residual-string rule).
function componentIdentityStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): string | null {
  const componentName = firstComponentModel(model)?.explicitName;
  if (!componentName) return null;

  const tagName = hostElement.tag;
  if (tagName !== tagName.toLowerCase()) return null;
  if (tagName === componentName || tagName.includes('-')) return null;
  if (hostElement.attributes.some((attribute) => attribute.name === 'kovo-c')) return null;

  return `kovo-c="${escapeAttribute(componentName)}"`;
}

function declaredQueryDepsStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): string | null {
  const deps = componentOptionObjectKeys(model, 'queries');
  if (deps.length === 0) return null;

  const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-deps');
  const existingDeps = splitDepValue(existing?.value ?? '');
  const depValue = mergeDepValues(existingDeps, deps).join(' ');
  return `kovo-deps="${escapeAttribute(depValue)}"`;
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function staticStateJson(model: ComponentModuleModel): string | null {
  const stateObject = componentStateReturnObjectModel(model);
  return stateObject?.staticValue ? JSON.stringify(stateObject.staticValue) : null;
}

function openingTagAttributeInsertion(
  hostElement: JsxElementModel,
  attributes: readonly string[],
): { position: number; replacement: string } {
  const attributeSource = attributes.join(' ');
  if (!hostElement.selfClosing) {
    return { position: hostElement.openingEnd - 1, replacement: ` ${attributeSource}` };
  }

  const position = hostElement.openingEnd - 2;
  return {
    position,
    replacement: hostElement.selfClosingSlashHasLeadingWhitespace
      ? `${attributeSource} `
      : ` ${attributeSource} `,
  };
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function renderSourceModule(renderedSource: string, exportPrefix: '' | 'export '): string {
  // Build the executable variant from the same lowered source facts instead of reparsing the
  // emitted artifact. This is a generated renderSource round-trip helper, not the SPEC §5.2
  // authored-vs-lowered semantic gate.
  return `${compilerIrHeader}
${exportPrefix}function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}
