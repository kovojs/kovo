import { runInNewContext } from 'node:vm';

import { compilerIrHeader } from '../ir.js';
import { emitElementParamTypes, type HandlerLowering } from '../lower/handlers.js';
import { parseLiteralObject } from '../scan/object.js';
import {
  componentOptionObjectKeys,
  componentRenderHost,
  componentStateReturnObject,
  firstComponentModel,
  type ComponentModuleModel,
} from '../scan/parse.js';
import {
  applySourceReplacements,
  escapeAttribute,
  splitDepValue,
  type SourceReplacement,
} from '../shared.js';
import type { RenderEquivalenceCheck } from '../types.js';

export function emitServerModule(renderedSource: string): string {
  return `${compilerIrHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

export function serverRenderSource(
  source: string,
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): string {
  return applyServerRenderPatches(source, handlers, model);
}

export function renderEquivalenceCheck(
  artifact: string,
  expected: string,
  serverSource: string,
): RenderEquivalenceCheck {
  const actual = emittedServerRenderSource(serverSource);

  return {
    actual,
    artifact,
    expected,
    ok: actual === expected,
  };
}

function emittedServerRenderSource(serverSource: string): string {
  const executable = executableRenderSource(serverSource);
  if (!executable) return '';

  try {
    const actual = runInNewContext(executable, {}, { timeout: 1000 });
    return typeof actual === 'string' ? actual : '';
  } catch {
    return '';
  }
}

function executableRenderSource(serverSource: string): string | null {
  const exportDeclaration = 'export function renderSource()';
  const exportIndex = serverSource.indexOf(exportDeclaration);
  if (exportIndex < 0) return null;

  const prelude = serverSource.slice(0, exportIndex).trim();
  if (prelude !== compilerIrHeader) return null;

  // SPEC 5.2.3 requires render(src) to equal render(compile(src)); execute the emitted
  // renderSource body instead of re-reading its template literal as inert text.
  return `${serverSource.slice(0, exportIndex)}function renderSource()${serverSource.slice(
    exportIndex + exportDeclaration.length,
  )}
;renderSource();`;
}

function applyServerRenderPatches(
  source: string,
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): string {
  const host = componentRenderHost(model);
  const patches: SourceReplacement[] = [];
  const hostHandlers = host
    ? handlers.filter(
        (handler) => handler.attributeStart >= host.start && handler.attributeEnd <= host.end,
      )
    : [];

  for (const handler of handlers) {
    if (hostHandlers.includes(handler)) continue;
    patches.push({
      end: handler.attributeEnd,
      replacement: handlerAttributeReplacement(handler),
      start: handler.attributeStart,
    });
  }

  if (host) {
    const tagSource = source.slice(host.start, host.end);
    const tagWithHandlers = replaceTagHandlerAttributes(tagSource, host.start, hostHandlers);
    const stampedTag = stampRenderHostTag(tagWithHandlers, model);
    if (stampedTag !== tagSource) {
      patches.push({ end: host.end, replacement: stampedTag, start: host.start });
    }
  }

  return applySourceReplacements(source, patches);
}

function replaceTagHandlerAttributes(
  tagSource: string,
  tagStart: number,
  handlers: readonly HandlerLowering[],
): string {
  return [...handlers]
    .sort((left, right) => right.attributeStart - left.attributeStart)
    .reduce((next, handler) => {
      const start = handler.attributeStart - tagStart;
      const end = handler.attributeEnd - tagStart;
      return `${next.slice(0, start)}${handlerAttributeReplacement(handler)}${next.slice(end)}`;
    }, tagSource);
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

function stampRenderHostTag(tagSource: string, model: ComponentModuleModel): string {
  return stampInitialState(
    stampDeclaredQueryDeps(stampComponentIdentity(tagSource, model), model),
    model,
  );
}

// SPEC.md §4.2: component identity is the fw-c stamp. The compiler omits it
// when the host tag already spells the component name (dashed tags are inert
// sugar) and emits it explicitly on native hosts (`<tr fw-c="cart-row">`), so
// authored sugar never hand-writes the stamp (§4.8 residual-string rule).
function stampComponentIdentity(tagSource: string, model: ComponentModuleModel): string {
  const componentName = firstComponentModel(model)?.explicitName;
  if (!componentName) return tagSource;

  const tagName = /^<([a-z][\w-]*)/.exec(tagSource)?.[1];
  if (!tagName || tagName === componentName || tagName.includes('-')) return tagSource;
  if (/\bfw-c=/.test(tagSource)) return tagSource;

  return stampOpeningTagAttribute(tagSource, 'fw-c', componentName);
}

function stampDeclaredQueryDeps(tagSource: string, model: ComponentModuleModel): string {
  const deps = componentOptionObjectKeys(model, 'queries');
  if (deps.length === 0) return tagSource;

  return stampOpeningTagDeps(tagSource, deps);
}

function stampInitialState(tagSource: string, model: ComponentModuleModel): string {
  const stateJson = staticStateJson(model);
  return stateJson ? stampOpeningTagAttribute(tagSource, 'fw-state', stateJson) : tagSource;
}

function stampOpeningTagDeps(tagSource: string, deps: readonly string[]): string {
  const depValue = mergeDepValues(readFwDepsAttribute(tagSource), deps).join(' ');
  const existing = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  if (existing?.groups) {
    return `${tagSource.slice(0, existing.index)}fw-deps=${existing[1]}${depValue}${existing[1]}${tagSource.slice(existing.index + existing[0].length)}`;
  }

  return stampOpeningTagAttribute(tagSource, 'fw-deps', depValue);
}

function stampOpeningTagAttribute(tagSource: string, name: string, value: string): string {
  return tagSource.replace(/\s*\/?>$/, (suffix) =>
    suffix.includes('/')
      ? ` ${name}="${escapeAttribute(value)}" />`
      : ` ${name}="${escapeAttribute(value)}">`,
  );
}

function readFwDepsAttribute(tagSource: string): string[] {
  const match = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  return splitDepValue(match?.groups?.deps ?? '');
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function staticStateJson(model: ComponentModuleModel): string | null {
  const stateObject = componentStateReturnObject(model);
  if (!stateObject) return null;

  const parsed = parseLiteralObject(stateObject);
  return parsed ? JSON.stringify(parsed) : null;
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}
