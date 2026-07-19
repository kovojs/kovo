import type { DiagnosticCode } from '@kovojs/core';
import {
  createRegisteredDiagnostic,
  diagnosticDefinitionText,
} from '@kovojs/core/internal/diagnostics';
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
  const message = input.preferHelp
    ? diagnosticDefinitionText(input.code, { preferHelp: true })
    : undefined;
  const site =
    'node' in input && input.node !== undefined
      ? sourceSiteForNode(input.node)
      : nonEmptyDiagnosticSite(input.site);

  return createRegisteredDiagnostic(
    input.code,
    { site },
    message === undefined
      ? input.detail === undefined
        ? undefined
        : { detail: input.detail }
      : { message: input.detail ? `${message} ${input.detail}` : message },
  );
}

/** @internal */
export function drizzleDiagnosticWithoutSite(input: {
  code: DiagnosticCode;
  detail?: string;
  preferHelp?: boolean;
}): TouchGraphDiagnostic {
  const message = input.preferHelp
    ? diagnosticDefinitionText(input.code, { preferHelp: true })
    : undefined;

  return createRegisteredDiagnostic(
    input.code,
    { site: NO_DIAGNOSTIC_SITE },
    message === undefined
      ? input.detail === undefined
        ? undefined
        : { detail: input.detail }
      : { message: input.detail ? `${message} ${input.detail}` : message },
  );
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
