import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

export type { DiagnosticCode };

export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
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
  source: string;
}

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
    viewTransitions: viewTransitionLowering.stamps,
  });

  return {
    diagnostics: handlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
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

export function scopeComponentCss(hostSelector: string, css: string): ScopedCssResult {
  const trimmed = css.trim();
  return {
    fallback: prefixCssSelectors(hostSelector, trimmed),
    scoped: `@scope (${hostSelector}) {\n${indent(trimmed)}\n}\n`,
  };
}

export function dedupeCss(chunks: readonly string[]): string {
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter(Boolean))].join('\n\n');
}

function isIr(source: string): boolean {
  return source.startsWith(irHeader);
}

function prefixCssSelectors(hostSelector: string, css: string): string {
  return css.replace(
    /(^|})(?<selector>[^{}@][^{}]*)\{/g,
    (_match, boundary: string, selector: string) => {
      const prefixed = selector
        .split(',')
        .map((part) => `${hostSelector} ${part.trim()}`)
        .join(', ');
      return `${boundary}${prefixed} {`;
    },
  );
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
    /<(?<tag>[A-Za-z][A-Za-z0-9-]*)\b(?<before>[^>]*)\sonClick=\{\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.(?<method>showModal|close|showPopover|hidePopover|togglePopover)\(\)\s*\}/g,
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
      diagnostic = diagnosticFor(options.fileName, 'FW201');
    }

    handlers.push({
      attributeName: `on:${eventName}`,
      attributeValue: `./${replaceExtension(options.fileName.split('/').at(-1) ?? options.fileName, '.client.js')}#${exportName}`,
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
  const renderedSource = handlers.reduce(
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
  );

  return `${irHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
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
`;
}
