import { emitElementParamTypes, type HandlerLowering } from '../lower/handlers.js';
import { parseLiteralObject } from '../scan/object.js';
import {
  componentOptionObjectKeys,
  componentRenderHost,
  componentStateReturnObject,
  firstComponentModel,
  parseComponentModule,
} from '../scan/parse.js';
import { escapeAttribute, splitDepValue } from '../shared.js';
import type { RenderEquivalenceCheck } from '../index.js';

const irHeader = '// @jiso-ir';

export function emitServerModule(source: string, handlers: HandlerLowering[]): string {
  const renderedSource = serverRenderSource(source, handlers);

  return `${irHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

export function serverRenderSource(source: string, handlers: readonly HandlerLowering[]): string {
  return stampInitialState(
    stampDeclaredQueryDeps(stampComponentIdentity(replaceHandlerAttributes(source, handlers))),
  );
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
  const returnIndex = serverSource.indexOf('return `');
  if (returnIndex < 0) return '';

  const start = returnIndex + 'return `'.length;
  let escaped = false;
  let raw = '';

  for (let index = start; index < serverSource.length; index += 1) {
    const char = serverSource[index];
    if (escaped) {
      if (char === '$' && serverSource[index + 1] === '{') {
        raw += '${';
        index += 1;
      } else {
        raw += char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '`') return raw;

    raw += char;
  }

  return '';
}

function replaceHandlerAttributes(source: string, handlers: readonly HandlerLowering[]): string {
  return [...handlers]
    .sort((left, right) => right.attributeStart - left.attributeStart)
    .reduce((next, handler) => {
      const replacement = [
        `${handler.attributeName}="${handler.attributeValue}"`,
        emitElementParamTypes(handler.params),
        ...handler.params.map(
          (param) => `${param.attributeName}="${escapeAttribute(param.value)}"`,
        ),
      ]
        .filter(Boolean)
        .join(' ');

      return `${next.slice(0, handler.attributeStart)}${replacement}${next.slice(handler.attributeEnd)}`;
    }, source);
}

function stampDeclaredQueryDeps(source: string): string {
  const model = parseComponentModule('component.tsx', source);
  const deps = componentOptionObjectKeys(model, 'queries');
  if (deps.length === 0) return source;

  const tag = componentRenderHost(model);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end);
  const stampedTag = stampOpeningTagDeps(tagSource, deps);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end)}`;
}

// SPEC.md §4.2: component identity is the fw-c stamp. The compiler omits it
// when the host tag already spells the component name (dashed tags are inert
// sugar) and emits it explicitly on native hosts (`<tr fw-c="cart-row">`), so
// authored sugar never hand-writes the stamp (§4.8 residual-string rule).
function stampComponentIdentity(source: string): string {
  const model = parseComponentModule('component.tsx', source);
  const componentName = firstComponentModel(model)?.explicitName;
  if (!componentName) return source;

  const tag = componentRenderHost(model);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end);
  const tagName = /^<([a-z][\w-]*)/.exec(tagSource)?.[1];
  if (!tagName || tagName === componentName || tagName.includes('-')) return source;
  if (/\bfw-c=/.test(tagSource)) return source;

  const stampedTag = stampOpeningTagAttribute(tagSource, 'fw-c', componentName);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end)}`;
}

function stampInitialState(source: string): string {
  const stateJson = staticStateJson(source);
  if (!stateJson) return source;

  const tag = componentRenderHost(parseComponentModule('component.tsx', source));
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end);
  const stampedTag = stampOpeningTagAttribute(tagSource, 'fw-state', stateJson);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end)}`;
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

function staticStateJson(source: string): string | null {
  const stateObject = componentStateReturnObject(parseComponentModule('component.tsx', source));
  if (!stateObject) return null;

  const parsed = parseLiteralObject(stateObject);
  return parsed ? JSON.stringify(parsed) : null;
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}
