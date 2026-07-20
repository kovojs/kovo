import type { DiagnosticCode } from '@kovojs/core';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  deriveRegisteredDiagnostic,
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

type DrizzleDiagnosticPresentation =
  | {
      code: 'KV406';
      /** Finite contextual rendering for opaque query reads that are not write sites. */
      messageVariant: 'raw-query-read';
      preferHelp?: never;
    }
  | {
      code: DiagnosticCode;
      messageVariant?: never;
      preferHelp?: boolean;
    };

type DrizzleDiagnosticInput = DiagnosticSite &
  DrizzleDiagnosticPresentation & {
    detail?: string;
  };

const NO_DIAGNOSTIC_SITE = '';

/** @internal */
export function drizzleDiagnostic(input: DrizzleDiagnosticInput): TouchGraphDiagnostic {
  const message =
    input.messageVariant === 'raw-query-read'
      ? 'Statically un-analyzable raw/opaque query read; declare output and reads: to attest the read set.'
      : input.preferHelp
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

/** @internal Re-mint a constructor-owned diagnostic at its final derived source site. */
export function relocateDrizzleDiagnostic(
  diagnostic: TouchGraphDiagnostic,
  site: string,
): TouchGraphDiagnostic {
  assertRegisteredDiagnostic(diagnostic, 'Drizzle diagnostic relocation source');
  return deriveRegisteredDiagnostic(
    diagnostic,
    { site: nonEmptyDiagnosticSite(site) },
    { message: diagnostic.message },
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
