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
  diagnostic?: CompilerDiagnostic;
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

  const clientSource = emitClientModule(handlers);
  const serverSource = emitServerModule(options.source, handlers, clientFileName);

  return {
    diagnostics: handlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
    files: [
      { fileName: serverFileName, source: serverSource },
      { fileName: clientFileName, source: clientSource },
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

export function jisoVitePlugin(): { name: string } {
  return { name: 'jiso' };
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
        `${handler.attributeName}="${handler.attributeValue}"`,
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
