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
}

export function createEmptyCompileResult(): CompileResult {
  return { diagnostics: [], files: [] };
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
    };
  }

  const componentName = inferComponentName(options);
  const handlers = lowerEventHandlers(options, componentName);
  const clientFileName = replaceExtension(options.fileName, '.client.js');
  const serverFileName = replaceExtension(options.fileName, '.server.js');
  const registryFileName = 'generated/registries.d.ts';

  const clientSource = emitClientModule(handlers);
  const serverSource = emitServerModule(options.source, handlers, clientFileName);
  const registrySource = emitRegistryModule({
    clientFileName,
    componentName,
    fragmentTargets: findFragmentTargets(options.source, componentName),
    handlers,
  });

  return {
    diagnostics: handlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
    files: [
      { fileName: serverFileName, source: serverSource },
      { fileName: clientFileName, source: clientSource },
      { fileName: registryFileName, source: registrySource },
    ],
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

function isIr(source: string): boolean {
  return source.startsWith(irHeader);
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
}): string {
  const handlerModuleLine = options.handlers.length
    ? `  '#${kebabCase(options.componentName)}': typeof import('../${options.clientFileName}');`
    : '';
  const fragmentTargetLines = options.fragmentTargets
    .map((target) => `  '${target}': unknown;`)
    .join('\n');

  return `${irHeader}
export interface HandlerModules {
${handlerModuleLine}
}

export interface FragmentTargets {
${fragmentTargetLines}
}
`;
}
