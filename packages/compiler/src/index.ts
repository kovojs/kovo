import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

export type { DiagnosticCode };

export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
  help?: string;
}

export interface EmittedFile {
  fileName: string;
  source: string;
}

export interface CompileResult {
  diagnostics: CompilerDiagnostic[];
  files: EmittedFile[];
  platformSubstitutions: PlatformSubstitution[];
  viewTransitions: ViewTransitionStamp[];
}

export function createEmptyCompileResult(): CompileResult {
  return { diagnostics: [], files: [], platformSubstitutions: [], viewTransitions: [] };
}

export interface CompileComponentOptions {
  fileName: string;
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
}

export interface RegistryFacts {
  domainKeys?: readonly string[];
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export type RegistryTypeFacts = Readonly<Record<string, string>>;

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

interface HandlerLowering {
  exportName: string;
  attributeName: string;
  attributeValue: string;
  params: ElementParam[];
  diagnostic?: CompilerDiagnostic;
}

interface ElementParam {
  attributeName: string;
  value: string;
}

export interface PlatformSubstitution {
  action: string;
  event: string;
  kind: 'dialog' | 'popover';
  tag: string;
  target: string;
}

export interface ViewTransitionStamp {
  name: string;
}

export interface JisoVitePlugin {
  name: 'jiso';
  transform: (
    source: string,
    id: string,
  ) => null | {
    code: string;
    map: null;
  };
}

const irHeader = '// @jiso-ir';

export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  if (isIr(options.source)) {
    return {
      diagnostics: [],
      files: [{ fileName: options.fileName, source: options.source }],
      platformSubstitutions: [],
      viewTransitions: [],
    };
  }

  const componentName = inferComponentName(options);
  const viewTransitionLowering = lowerViewTransitions(options.source);
  const platformLowering = lowerPlatformBehaviors(viewTransitionLowering.source);
  const source = platformLowering.source;
  const handlers = lowerEventHandlers({ ...options, source }, componentName);
  const serverFactStateDiagnostics = validateServerFactsInLocalState(source, options.fileName);
  const fragmentInputDiagnostics = validateFragmentTargetInputs(source, options.fileName);
  const dataBindDiagnostics = validateDataBindings(source, options);
  const directDbDiagnostics = validateDirectDbAccess(source, options.fileName);
  const clientFileName = replaceExtension(options.fileName, '.client.js');
  const serverFileName = replaceExtension(options.fileName, '.server.js');
  const registryFileName = 'generated/registries.d.ts';

  const clientSource = emitClientModule(handlers);
  const serverSource = emitServerModule(source, handlers, clientFileName);
  const registrySource = emitRegistryModule({
    clientFileName,
    componentName,
    fragmentTargets: findFragmentTargets(source, componentName),
    handlers,
    platformSubstitutions: platformLowering.substitutions,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: viewTransitionLowering.stamps,
  });

  return {
    diagnostics: [
      ...handlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
      ...serverFactStateDiagnostics,
      ...fragmentInputDiagnostics,
      ...dataBindDiagnostics,
      ...directDbDiagnostics,
    ],
    files: [
      { fileName: serverFileName, source: serverSource },
      { fileName: clientFileName, source: clientSource },
      { fileName: registryFileName, source: registrySource },
    ],
    platformSubstitutions: platformLowering.substitutions,
    viewTransitions: viewTransitionLowering.stamps,
  };
}

export function assertFixpoint(result: CompileResult): void {
  for (const file of result.files) {
    const recompiled = compileComponentModule(file);
    const sameFile =
      recompiled.files.length === 1 &&
      recompiled.files[0]?.fileName === file.fileName &&
      recompiled.files[0]?.source === file.source;

    if (!sameFile) {
      throw new Error(`Fixpoint failed for ${file.fileName}`);
    }
  }
}

export function collectMinifierReservedNames(result: CompileResult): string[] {
  const reserved = new Set<string>();
  const handlerExportPattern = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*handler\s*\(/gm;

  for (const file of result.files) {
    if (!file.fileName.endsWith('.client.js')) continue;

    for (const match of file.source.matchAll(handlerExportPattern)) {
      const exportName = match[1];
      if (exportName) reserved.add(exportName);
    }
  }

  return [...reserved].sort();
}

export function jisoVitePlugin(): JisoVitePlugin {
  return {
    name: 'jiso',
    transform(source: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const result = compileComponentModule({ fileName: id, source });
      return {
        code: result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? source,
        map: null,
      };
    },
  };
}

export interface ScopedCssResult {
  fallback: string;
  scoped: string;
}

export interface ScopeComponentCssOptions {
  nestedHostSelectors?: readonly string[];
}

export function scopeComponentCss(
  hostSelector: string,
  css: string,
  options: ScopeComponentCssOptions = {},
): ScopedCssResult {
  const trimmed = css.trim();
  const nestedHostSelectors = options.nestedHostSelectors ?? ['[fw-c]'];

  return {
    fallback: prefixCssSelectors(hostSelector, trimmed, nestedHostSelectors),
    scoped: `@scope (${hostSelector}) to (${scopeLimitSelectors(nestedHostSelectors)}) {\n${indent(trimmed)}\n}\n`,
  };
}

export function dedupeCss(chunks: readonly string[]): string {
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter(Boolean))].join('\n\n');
}

function isIr(source: string): boolean {
  return source.startsWith(irHeader);
}

function prefixCssSelectors(
  hostSelector: string,
  css: string,
  nestedHostSelectors: readonly string[],
): string {
  const nestedExclusion = selectorExclusion(nestedHostSelectors);

  return css.replace(
    /(^|})(?<selector>[^{}@][^{}]*)\{/g,
    (_match, boundary: string, selector: string) => {
      const prefixed = selector
        .split(',')
        .map((part) => `${hostSelector} ${part.trim()}${nestedExclusion}`)
        .join(', ');
      return `${boundary}${prefixed} {`;
    },
  );
}

function scopeLimitSelectors(nestedHostSelectors: readonly string[]): string {
  return nestedHostSelectors.map((selector) => `:scope ${selector}`).join(', ');
}

function selectorExclusion(nestedHostSelectors: readonly string[]): string {
  return nestedHostSelectors
    .flatMap((selector) => [`:not(${selector})`, `:not(${selector} *)`])
    .join('');
}

function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function inferComponentName(options: CompileComponentOptions): string {
  const exportMatch = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(options.source);
  if (exportMatch?.[1]) return exportMatch[1];

  const baseName =
    options.fileName
      .replace(/\.[^.]+$/, '')
      .split('/')
      .at(-1) ?? 'Component';
  return baseName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function lowerViewTransitions(source: string): {
  source: string;
  stamps: ViewTransitionStamp[];
} {
  const stamps: ViewTransitionStamp[] = [];
  const nextSource = source.replace(
    /\sviewTransitionName=(["'])(?<name>[^"']+)\1/g,
    (_match, _quote: string, name: string) => {
      stamps.push({ name });
      return ` style="view-transition-name: ${escapeAttribute(name)}"`;
    },
  );

  return {
    source: nextSource,
    stamps,
  };
}

function lowerPlatformBehaviors(source: string): {
  source: string;
  substitutions: PlatformSubstitution[];
} {
  const substitutions: PlatformSubstitution[] = [];
  const nextSource = source.replace(
    /<(?<tag>[A-Za-z][A-Za-z0-9-]*)\b(?<before>[^>]*)\sonClick=\{\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.(?<method>showModal|close|requestClose|showPopover|hidePopover|togglePopover)\(\)\s*\}/g,
    (match, tag: string, before: string, target: string, method: string) => {
      const substitution = platformSubstitutionFor(tag, target, method);
      if (!substitution) return match;

      substitutions.push(substitution);
      return `<${tag}${before} ${platformAttributes(substitution)}`;
    },
  );

  return {
    source: nextSource,
    substitutions,
  };
}

function platformSubstitutionFor(
  tag: string,
  target: string,
  method: string,
): PlatformSubstitution | null {
  if (method === 'showModal') {
    return { action: 'show-modal', event: 'click', kind: 'dialog', tag, target };
  }

  if (method === 'close') {
    return { action: 'close', event: 'click', kind: 'dialog', tag, target };
  }

  // SPEC §5.2.4: provable dialog handlers lower to platform invoker commands.
  if (method === 'requestClose') {
    return { action: 'request-close', event: 'click', kind: 'dialog', tag, target };
  }

  const popoverActionByMethod: Record<string, string> = {
    hidePopover: 'hide',
    showPopover: 'show',
    togglePopover: 'toggle',
  };
  const action = popoverActionByMethod[method];
  if (!action) return null;

  return { action, event: 'click', kind: 'popover', tag, target };
}

function platformAttributes(substitution: PlatformSubstitution): string {
  if (substitution.kind === 'dialog') {
    return `commandfor="${escapeAttribute(substitution.target)}" command="${substitution.action}"`;
  }

  return `popovertarget="${escapeAttribute(substitution.target)}" popovertargetaction="${substitution.action}"`;
}

function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const eventAttributePattern =
    /<(?<tag>[A-Za-z][A-Za-z0-9-]*)\b(?<before>[^>]*)\son(?<event>[A-Z][A-Za-z0-9]*)=\{(?<expression>[^}]*)\}/g;

  for (const match of options.source.matchAll(eventAttributePattern)) {
    const tag = match.groups?.tag ?? 'element';
    const event = match.groups?.event ?? 'Event';
    const expression = (match.groups?.expression ?? '').trim();
    const namedHandler = /^[A-Za-z_$][\w$]*$/.test(expression);
    const params = namedHandler ? [] : extractElementParams(expression);
    const eventName = event.toLowerCase();
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : `${componentName}$${tag}_${eventName}`;

    let diagnostic: CompilerDiagnostic | undefined;
    if (!namedHandler) {
      diagnostic = diagnosticFor(options.fileName, 'FW210');
    }

    if (capturesUnserializableValue(expression)) {
      diagnostic = fw201Diagnostic(options.fileName, {
        attributeName: `on:${eventName}`,
        exportName,
        expression,
        params,
      });
    }

    handlers.push({
      attributeName: `on:${eventName}`,
      attributeValue: `${clientModuleUrl(options.fileName)}#${exportName}`,
      ...(diagnostic ? { diagnostic } : {}),
      exportName,
      params,
    });
  }

  return handlers;
}

function capturesUnserializableValue(expression: string): boolean {
  return (
    /\b(window|document|db|request|response)\b/.test(expression) ||
    /\bnew\s+(Date|Map|Set)\b/.test(expression)
  );
}

function diagnosticFor(fileName: string, code: DiagnosticCode): CompilerDiagnostic {
  const definition = diagnosticDefinitions[code];
  return {
    code,
    fileName,
    message: definition.message,
    severity: definition.severity,
  };
}

function fw201Diagnostic(
  fileName: string,
  lowering: {
    attributeName: string;
    exportName: string;
    expression: string;
    params: readonly ElementParam[];
  },
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW201'),
    help: [
      `Would lower to: ${lowering.attributeName}="${clientModuleUrl(fileName)}#${lowering.exportName}"`,
      `Blocked expression: ${lowering.expression}`,
      `Element params: ${lowering.params.map((param) => param.attributeName).join(', ') || '-'}`,
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    ].join('\n'),
  };
}

function clientModuleUrl(fileName: string): string {
  return `/c/${replaceExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
}

function validateDataBindings(
  source: string,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  if (!options.queryShapes) return [];

  return [...source.matchAll(/\bdata-bind=(["'])(?<path>[^"']+)\1/g)]
    .map((match) => match.groups?.path ?? '')
    .filter(Boolean)
    .filter((path) => !pathExistsInQueryShapes(path, options.queryShapes ?? {}))
    .map((path) => ({
      code: 'FW302' as const,
      fileName: options.fileName,
      message: `data-bind path is not present in the declared query shape: ${path}`,
      severity: 'error' as const,
    }));
}

// SPEC 5.2: query data is shared/server-owned; island-local state is private/client-owned.
function validateServerFactsInLocalState(source: string, fileName: string): CompilerDiagnostic[] {
  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const stateObject = extractStateReturnObject(source);
  if (!queryObject || !stateObject) return [];

  const queryNames = topLevelObjectKeys(queryObject);
  const stateKeys = topLevelObjectKeys(stateObject);
  if (queryNames.length === 0 || stateKeys.length === 0) return [];

  const storesServerFact = stateKeys.some((stateKey) =>
    queryNames.some((queryName) => stateKeyHasQueryPrefix(stateKey, queryName)),
  );

  return storesServerFact ? [diagnosticFor(fileName, 'FW301')] : [];
}

function validateFragmentTargetInputs(source: string, fileName: string): CompilerDiagnostic[] {
  if (!/fragmentTarget\s*:\s*true/.test(source)) return [];

  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const propsObject = extractObjectLiteralAfterProperty(source, 'props');
  const allowedInputs = new Set([
    ...topLevelObjectKeys(queryObject ?? '{}'),
    ...topLevelObjectKeys(propsObject ?? '{}'),
  ]);
  const renderInputs = extractFirstRenderObjectPattern(source);
  if (renderInputs.length === 0) return [];

  const missing = renderInputs.filter((input) => !allowedInputs.has(input));
  return missing.map((input) => ({
    ...diagnosticFor(fileName, 'FW303'),
    message: `${diagnosticDefinitions.FW303.message} ${input}`,
  }));
}

function validateDirectDbAccess(source: string, fileName: string): CompilerDiagnostic[] {
  if (!/\bmutation\s*\(/.test(source)) return [];

  for (const handler of findHandlerBodies(source)) {
    const params = handler.params.map(readParameterName).filter(Boolean);
    const receivesDb = params.includes('db');
    const requestParam = params.find(
      (param) =>
        param === 'request' || /request$/i.test(param) || param === 'ctx' || param === 'context',
    );
    const readsRequestDb =
      requestParam !== undefined &&
      new RegExp(`\\b${escapeRegExp(requestParam)}\\.db\\b`).test(handler.body);

    if (receivesDb || readsRequestDb) {
      return [diagnosticFor(fileName, 'FW330')];
    }
  }

  return [];
}

function findHandlerBodies(source: string): { body: string; params: string[] }[] {
  const handlers: { body: string; params: string[] }[] = [];
  const methodPattern = /\bhandler\s*\((?<params>[^)]*)\)\s*\{/g;
  const propertyPattern = /\bhandler\s*:\s*(?:async\s*)?\((?<params>[^)]*)\)\s*=>\s*\{/g;

  for (const match of source.matchAll(methodPattern)) {
    const bodyStart = match.index + match[0].lastIndexOf('{');
    const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
    if (bodyEnd === -1) continue;

    handlers.push({
      body: source.slice(bodyStart, bodyEnd + 1),
      params: splitParameters(match.groups?.params ?? ''),
    });
  }

  for (const match of source.matchAll(propertyPattern)) {
    const bodyStart = match.index + match[0].lastIndexOf('{');
    const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
    if (bodyEnd === -1) continue;

    handlers.push({
      body: source.slice(bodyStart, bodyEnd + 1),
      params: splitParameters(match.groups?.params ?? ''),
    });
  }

  return handlers;
}

function splitParameters(params: string): string[] {
  return params
    .split(',')
    .map((param) => param.trim())
    .filter(Boolean);
}

function readParameterName(param: string): string {
  const withoutType = param.split(':')[0]?.trim() ?? '';
  return withoutType.replace(/^[.{\s]+|[}\s]+$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFirstRenderObjectPattern(source: string): string[] {
  const match = /\brender\s*:\s*\(\s*\{/.exec(source);
  if (!match) return [];

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return [];

  return topLevelObjectKeys(source.slice(objectStart, objectEnd + 1));
}

function extractObjectLiteralAfterProperty(source: string, propertyName: string): string | null {
  const match = new RegExp(`\\b${propertyName}\\s*:\\s*\\{`).exec(source);
  if (!match) return null;

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return null;

  return source.slice(objectStart, objectEnd + 1);
}

function extractStateReturnObject(source: string): string | null {
  const match = /\bstate\s*:\s*\(\s*\)\s*=>\s*\(\s*\{/.exec(source);
  if (!match) return null;

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return null;

  return source.slice(objectStart, objectEnd + 1);
}

function topLevelObjectKeys(objectSource: string): string[] {
  const keys: string[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] === ':') {
      keys.push(key.name);
      index = skipObjectValue(objectSource, afterKey + 1);
      continue;
    }

    keys.push(key.name);
    index = skipObjectValue(objectSource, afterKey);
  }

  return keys;
}

function readObjectKey(source: string, start: number): { name: string; end: number } | null {
  const char = source[start];
  if (char === '"' || char === "'") {
    const end = findStringEnd(source, start, char);
    if (end === -1) return null;

    return {
      end: end + 1,
      name: source.slice(start + 1, end),
    };
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier?.[0]) return null;

  return {
    end: start + identifier[0].length,
    name: identifier[0],
  };
}

function skipObjectValue(source: string, start: number): number {
  let index = start;
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;

  while (index < source.length - 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length - 1 : end + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length - 1 : nextLine + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length - 1 : commentEnd + 2;
      continue;
    }

    if (char === '{') curlyDepth += 1;
    if (char === '}') {
      if (curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      curlyDepth -= 1;
    }

    if (char === '[') squareDepth += 1;
    if (char === ']') squareDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;

    if (char === ',' && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    return index;
  }

  return index;
}

function findMatchingToken(source: string, start: number, open: string, close: string): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }

    if (source[index] === quote) return index;
  }

  return -1;
}

function stateKeyHasQueryPrefix(stateKey: string, queryName: string): boolean {
  if (stateKey === queryName) return true;
  if (!stateKey.startsWith(queryName)) return false;

  const nextChar = stateKey[queryName.length];
  return nextChar !== undefined && /[A-Z0-9_$]/.test(nextChar);
}

function pathExistsInQueryShapes(path: string, queryShapes: Record<string, QueryShape>): boolean {
  const [queryName, ...segments] = path.split('.');
  if (!queryName) return false;

  const shape = queryShapes[queryName];
  if (!shape || segments.length === 0) return Boolean(shape);

  return pathExistsInShape(shape, segments);
}

function pathExistsInShape(shape: QueryShape, segments: readonly string[]): boolean {
  if (segments.length === 0) return true;

  if (isArrayShape(shape)) {
    const itemShape = shape[0];
    return itemShape !== undefined && pathExistsInShape(itemShape, segments);
  }

  if (typeof shape !== 'object' || shape === null) return false;

  const [head, ...tail] = segments;
  if (!head || !(head in shape)) return false;

  return pathExistsInShape(shape[head] ?? 'object', tail);
}

function isArrayShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
}

function emitClientModule(handlers: HandlerLowering[]): string {
  const exports = handlers.length
    ? handlers
        .map((handler) => `export const ${handler.exportName} = handler((_event, _ctx) => {});`)
        .join('\n')
    : '// no client handlers emitted';

  return `${irHeader}
import { handler } from '@jiso/runtime';

${exports}
`;
}

function emitServerModule(
  source: string,
  handlers: HandlerLowering[],
  _clientFileName: string,
): string {
  const renderedSource = stampDeclaredQueryDeps(
    handlers.reduce(
      (next, handler) =>
        next.replace(
          /on[A-Z][A-Za-z0-9]*=\{[^}]*\}/,
          [
            `${handler.attributeName}="${handler.attributeValue}"`,
            ...handler.params.map(
              (param) => `${param.attributeName}="${escapeAttribute(param.value)}"`,
            ),
          ].join(' '),
        ),
      source,
    ),
  );

  return `${irHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

function stampDeclaredQueryDeps(source: string): string {
  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const deps = topLevelObjectKeys(queryObject ?? '{}');
  if (deps.length === 0) return source;

  const tag = findFirstRenderedOpeningTag(source);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end + 1);
  const stampedTag = stampOpeningTagDeps(tagSource, deps);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end + 1)}`;
}

function findFirstRenderedOpeningTag(source: string): { end: number; start: number } | null {
  const renderMatch = /\brender\s*:/.exec(source);
  if (!renderMatch) return null;

  const tagMatch = /<[A-Za-z][\w:-]*\b/.exec(source.slice(renderMatch.index));
  if (!tagMatch) return null;

  const tagStart = renderMatch.index + tagMatch.index;
  const tagEnd = findOpeningTagEnd(source, tagStart);
  if (tagEnd === -1) return null;

  return { end: tagEnd, start: tagStart };
}

function findOpeningTagEnd(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '>') return index;
  }

  return -1;
}

function stampOpeningTagDeps(tagSource: string, deps: readonly string[]): string {
  const depValue = mergeDepValues(readFwDepsAttribute(tagSource), deps).join(' ');
  const existing = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  if (existing?.groups) {
    return `${tagSource.slice(0, existing.index)}fw-deps=${existing[1]}${depValue}${existing[1]}${tagSource.slice(existing.index + existing[0].length)}`;
  }

  return tagSource.replace(/\s*\/?>$/, (suffix) =>
    suffix.includes('/') ? ` fw-deps="${depValue}" />` : ` fw-deps="${depValue}">`,
  );
}

function readFwDepsAttribute(tagSource: string): string[] {
  const match = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  return splitDepValue(match?.groups?.deps ?? '');
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function replaceExtension(fileName: string, extension: string): string {
  return fileName.replace(/\.[^.]+$/, extension);
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function extractElementParams(expression: string): ElementParam[] {
  const callMatch = /^\(\)\s*=>\s*[A-Za-z_$][\w$]*\((?<args>.*)\)$/.exec(expression);
  if (!callMatch?.groups?.args) return [];

  return splitArguments(callMatch.groups.args)
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0 && arg !== 'state')
    .map((arg) => ({
      attributeName: `data-p-${paramNameForExpression(arg)}`,
      value: `{${arg}}`,
    }));
}

function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(args.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(args.slice(start));
  return parts;
}

function paramNameForExpression(expression: string): string {
  const segments = expression
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  const last = segments.at(-1) ?? expression;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function findFragmentTargets(source: string, componentName: string): string[] {
  if (!/fragmentTarget\s*:\s*true/.test(source)) return [];

  const explicitName = /component\(\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  return [explicitName ?? kebabCase(componentName)];
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function emitRegistryModule(options: {
  clientFileName: string;
  componentName: string;
  fragmentTargets: string[];
  handlers: HandlerLowering[];
  platformSubstitutions: PlatformSubstitution[];
  registryFacts?: RegistryFacts;
  viewTransitions: ViewTransitionStamp[];
}): string {
  const handlerModuleLine = options.handlers.length
    ? `  '#${kebabCase(options.componentName)}': typeof import('../${options.clientFileName}');`
    : '';
  const fragmentTargetLines = options.fragmentTargets
    .map((target) => `  '${target}': unknown;`)
    .join('\n');
  const platformSubstitutionLines = options.platformSubstitutions
    .map(
      (substitution) =>
        `  '${options.componentName}:${substitution.tag}:${substitution.event}:${substitution.target}': '${substitution.kind}:${substitution.action}';`,
    )
    .join('\n');
  const viewTransitionLines = options.viewTransitions
    .map((stamp) => `  '${stamp.name}': unknown;`)
    .join('\n');
  const queryRegistryLines = registryTypeFactLines(options.registryFacts?.queries);
  const mutationRegistryLines = registryTypeFactLines(options.registryFacts?.mutations);
  const domainKey = registryDomainKey(options.registryFacts?.domainKeys);

  return `${irHeader}
export interface HandlerModules {
${handlerModuleLine}
}

export interface FragmentTargets {
${fragmentTargetLines}
}

export interface PlatformSubstitutions {
${platformSubstitutionLines}
}

export interface ViewTransitions {
${viewTransitionLines}
}

export interface QueryRegistry {
${queryRegistryLines}
}

export interface MutationRegistry {
${mutationRegistryLines}
}

export type DomainKey = ${domainKey};
`;
}

function registryTypeFactLines(facts: RegistryTypeFacts | undefined): string {
  return Object.entries(facts ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, typeExpression]) => `  '${key}': ${typeExpression};`)
    .join('\n');
}

function registryDomainKey(domainKeys: readonly string[] | undefined): string {
  const keys = [...new Set(domainKeys ?? [])].sort();
  return keys.map((key) => JSON.stringify(key)).join(' | ') || 'never';
}
