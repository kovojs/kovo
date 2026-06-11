import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { literalValue } from '../scan/object.js';
import { identifierReferences, jsxElements, parseComponentModule } from '../scan/parse.js';
import { replaceExtension } from '../shared.js';
import type { CompileComponentOptions } from '../types.js';

export interface HandlerLowering {
  exportName: string;
  attributeName: string;
  attributeEnd: number;
  attributeStart: number;
  attributeValue: string;
  expression: string;
  params: ElementParam[];
  diagnostic?: CompilerDiagnostic;
}

export interface ElementParam {
  attributeName: string;
  type: ElementParamType;
  value: string;
}

type ElementParamType = 'boolean' | 'number' | 'string';

export function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const anonymousNameCounts = new Map<string, number>();

  for (const eventAttribute of eventAttributes(options.source)) {
    const { attributeEnd, attributeStart, event, expression, tag } = eventAttribute;
    const namedHandler = /^[A-Za-z_$][\w$]*$/.test(expression);
    const params = namedHandler ? [] : extractElementParams(expression);
    const eventName = event.toLowerCase();
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : uniqueAnonymousHandlerName(componentName, tag, eventName, anonymousNameCounts);

    let diagnostic: CompilerDiagnostic | undefined;
    if (!namedHandler) {
      diagnostic = diagnosticFor(
        options.fileName,
        'FW210',
        options.source,
        attributeStart,
        event.length,
      );
    }

    if (capturesUnserializableValue(expression)) {
      diagnostic = fw201Diagnostic(options.fileName, options.source, attributeStart, {
        attributeName: `on:${eventName}`,
        exportName,
        expression,
        params,
      });
    }

    handlers.push({
      attributeName: `on:${eventName}`,
      attributeEnd,
      attributeStart,
      attributeValue: `${clientModuleUrl(options.fileName)}#${exportName}`,
      ...(diagnostic ? { diagnostic } : {}),
      expression,
      exportName,
      params,
    });
  }

  return handlers;
}

export function versionHandlerLowering(
  handler: HandlerLowering,
  fileName: string,
  clientHref: string,
): HandlerLowering {
  const unversionedHref = clientModuleUrl(fileName);
  const versionedAttributeValue = `${clientHref}#${handler.exportName}`;
  return {
    ...handler,
    attributeValue: versionedAttributeValue,
    ...(handler.diagnostic
      ? {
          diagnostic: {
            ...handler.diagnostic,
            ...(handler.diagnostic.help
              ? {
                  help: handler.diagnostic.help.replaceAll(`${unversionedHref}#`, `${clientHref}#`),
                }
              : {}),
          },
        }
      : {}),
  };
}

export function clientModuleUrl(fileName: string, version?: string): string {
  const href = `/c/${replaceExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
  return version ? `${href}?v=${version}` : href;
}

export function clientModuleVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function emitElementParamTypes(params: readonly ElementParam[]): string {
  const typedParams = params.filter((param) => param.type !== 'string');
  if (typedParams.length === 0) return '';

  const entries = typedParams
    .map((param) => `${paramNameFromAttribute(param.attributeName)}:${param.type}`)
    .join(',');
  return `fw-param-types="${entries}"`;
}

function eventAttributes(source: string): Array<{
  attributeEnd: number;
  attributeStart: number;
  event: string;
  expression: string;
  tag: string;
}> {
  const attributes: Array<{
    attributeEnd: number;
    attributeStart: number;
    event: string;
    expression: string;
    tag: string;
  }> = [];

  for (const element of jsxElements(parseComponentModule('component.tsx', source))) {
    for (const attribute of element.attributes) {
      const event = jsxEventAttributeName(attribute.name);
      if (!event || attribute.expression === undefined) continue;
      attributes.push({
        attributeEnd: attribute.end,
        attributeStart: attribute.start,
        event,
        expression: attribute.expression,
        tag: element.tag,
      });
    }
  }

  return attributes;
}

function jsxEventAttributeName(name: string): string | null {
  if (!/^on[A-Z][A-Za-z0-9]*$/.test(name)) return null;
  return name.slice(2);
}

function uniqueAnonymousHandlerName(
  componentName: string,
  tag: string,
  eventName: string,
  counts: Map<string, number>,
): string {
  const base = `${componentName}$${tag}_${eventName}`;
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);

  return count === 1 ? base : `${base}_${count}`;
}

export function capturesUnserializableValue(expression: string): boolean {
  const references = new Set(identifierReferences('expression.tsx', expression));
  return ['window', 'document', 'db', 'request', 'response', 'Date', 'Map', 'Set'].some((name) =>
    references.has(name),
  );
}

function fw201Diagnostic(
  fileName: string,
  source: string,
  offset: number,
  lowering: {
    attributeName: string;
    exportName: string;
    expression: string;
    params: readonly ElementParam[];
  },
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.FW201;
  const labels = definition.detailLabels;
  return {
    ...diagnosticFor(fileName, 'FW201', source, offset, lowering.attributeName.length),
    help: [
      `${labels.handlerLowering} ${lowering.attributeName}="${clientModuleUrl(fileName)}#${lowering.exportName}"`,
      `${labels.blockedExpression} ${lowering.expression}`,
      `${labels.elementParams} ${lowering.params.map((param) => param.attributeName).join(', ') || '-'}`,
      definition.help ?? '',
    ].join('\n'),
  };
}

function extractElementParams(expression: string): ElementParam[] {
  const callMatch = /^\(\)\s*=>\s*[A-Za-z_$][\w$]*\((?<args>.*)\)$/.exec(expression);
  const expressions = callMatch?.groups?.args
    ? splitArguments(callMatch.groups.args)
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0 && arg !== 'state')
        .flatMap((arg) => {
          if (literalValue(arg) !== undefined) return [];
          const members = serializableMemberExpressions(arg);
          return members.length > 0 ? members : [arg];
        })
    : serializableMemberExpressions(expression);

  return dedupeStrings(expressions).map((arg) => ({
    attributeName: `data-p-${paramNameForExpression(arg)}`,
    type: inferElementParamType(expression, arg),
    value: `{${arg}}`,
  }));
}

function inferElementParamType(expression: string, sourceExpression: string): ElementParamType {
  const ref = sourceExpressionRef(sourceExpression);
  if (usedAsBoolean(expression, ref)) return 'boolean';
  if (usedAsNumber(expression, ref)) return 'number';

  return 'string';
}

function sourceExpressionRef(sourceExpression: string): string {
  return `(?<![\\w$])${escapeRegExp(sourceExpression)}(?![\\w$])`;
}

function usedAsBoolean(expression: string, ref: string): boolean {
  return (
    new RegExp(`!\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:\\?|&&|\\|\\|)`).test(expression) ||
    new RegExp(`(?:&&|\\|\\|)\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:===|!==|==|!=)\\s*(?:true|false)\\b`).test(expression) ||
    new RegExp(`(?:true|false)\\s*(?:===|!==|==|!=)\\s*${ref}`).test(expression)
  );
}

function usedAsNumber(expression: string, ref: string): boolean {
  return (
    new RegExp(`(?:[+\\-*/%]=|[-*/%])\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:[-*/%]|[+\\-*/%]=)`).test(expression) ||
    new RegExp(`${ref}\\s*(?:===|!==|==|!=|[<>]=?)\\s*-?\\d`).test(expression) ||
    new RegExp(`-?\\d(?:\\.\\d+)?\\s*(?:===|!==|==|!=|[<>]=?)\\s*${ref}`).test(expression)
  );
}

function serializableMemberExpressions(expression: string): string[] {
  const members = expression.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g) ?? [];

  return members.filter(
    (member) =>
      !member.startsWith('state.') &&
      !member.startsWith('ctx.') &&
      !member.startsWith('document.') &&
      !member.startsWith('window.'),
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (char === '"' || char === "'") {
      index = skipQuotedString(args, index, char);
      continue;
    }
    if (char === '`') {
      index = skipTemplateLiteral(args, index);
      continue;
    }
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

function skipQuotedString(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === quote) return index;
  }

  return source.length - 1;
}

function skipTemplateLiteral(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '`') return index;
  }

  return source.length - 1;
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

function paramNameFromAttribute(attributeName: string): string {
  return attributeName
    .replace(/^data-p-/, '')
    .replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
