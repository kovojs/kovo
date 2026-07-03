import type { DiagnosticCode } from '@kovojs/core';
import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { Node } from 'ts-morph';
import type { TouchGraphDiagnostic } from '../graph.js';

type DiagnosticSite =
  | {
      node: Node;
      site?: never;
    }
  | {
      node?: never;
      site: string;
    };

type DrizzleDiagnosticInput = DiagnosticSite & {
  code: DiagnosticCode;
  detail?: string;
  preferHelp?: boolean;
};

const NO_DIAGNOSTIC_SITE = '';

/** @internal */
export function drizzleDiagnostic(input: DrizzleDiagnosticInput): TouchGraphDiagnostic {
  const definition = diagnosticDefinitions[input.code];
  const message = input.preferHelp
    ? diagnosticDefinitionText(input.code, { preferHelp: true })
    : definition.message;
  const site =
    'node' in input && input.node !== undefined
      ? sourceSiteForNode(input.node)
      : nonEmptyDiagnosticSite(input.site);

  return {
    code: input.code,
    message: input.detail ? `${message} ${input.detail}` : message,
    severity: definition.severity,
    site,
  };
}

/** @internal */
export function drizzleDiagnosticWithoutSite(input: {
  code: DiagnosticCode;
  detail?: string;
  preferHelp?: boolean;
}): TouchGraphDiagnostic {
  const definition = diagnosticDefinitions[input.code];
  const message = input.preferHelp
    ? diagnosticDefinitionText(input.code, { preferHelp: true })
    : definition.message;

  return {
    code: input.code,
    message: input.detail ? `${message} ${input.detail}` : message,
    severity: definition.severity,
    site: NO_DIAGNOSTIC_SITE,
  };
}

/** @internal */
export function sourceSiteForNode(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStartLineNumber()}`;
}

function nonEmptyDiagnosticSite(site: string): string {
  if (site.length === 0) {
    throw new Error('Drizzle diagnostics require a source node or non-empty explicit site.');
  }
  return site;
}
