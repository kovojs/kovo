import { contextualOutputSinkFamilyForAttribute } from '@kovojs/core/internal/sink-policy';
import {
  expressionResolvesToAnyFrameworkExport,
  frameworkExport,
  frameworkExportForModuleSpecifier,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import * as ts from 'typescript';

import type { ComponentModuleModel } from './scan/parse.js';

/**
 * @internal Output contexts for compiler-generated writes. These facts make SPEC §1.2's
 * machine-auditable generation rule explicit before emit code chooses escaping/sanitization.
 */
export type OutputContext =
  | 'text'
  | 'attribute'
  | 'boolean-attribute'
  | 'url-attribute'
  | 'style-property'
  | 'css-text'
  | 'html-fragment'
  | 'script-text'
  | 'trusted-html';

/**
 * @internal Lowered-IR fact recording a compiler-generated write sink and output context.
 * In-repo diagnostics and analysis use only (SPEC.md §5.2).
 */
export interface GeneratedOutputWriteFact {
  context: OutputContext;
  expression?: string;
  sink: string;
  source: 'client-query' | 'client-state' | 'server-render' | 'style-extraction' | 'template-stamp';
  writer: string;
}

/**
 * @internal The documented public entrypoint and export names of the trusted-output escape-hatch
 * brands (`trustedHtml`, `safeRichHtml`). SPEC §4.8 / §5.2 #8: app source imports the brand only
 * from this entrypoint.
 */
const TRUSTED_HTML_ESCAPE_EXPORTS = [
  frameworkExport('@kovojs/browser', 'trustedHtml'),
  frameworkExport('@kovojs/browser', 'safeRichHtml'),
  frameworkExport('@kovojs/server', 'safeRichHtml'),
] as const;

const TRUSTED_HTML_PURE_BRAND_EXPORTS = [
  frameworkExport('@kovojs/browser', 'trustedHtml'),
] as const;

const TRUSTED_URL_PURE_BRAND_EXPORTS = [frameworkExport('@kovojs/browser', 'trustedUrl')] as const;

const RENDERED_HTML_RAW_SINK_EXPORTS = [frameworkExport('@kovojs/server', 'renderedHtml')] as const;

/**
 * @internal The local identifiers in this module that are bound to the REAL trusted-HTML brand
 * exports, resolved from canonical framework export identity.
 *
 * SPEC §6.6(1) ("classification is carried by AST symbol-identity provenance … never [a] text
 * heuristic") and §5.2 rule 9 (post-parse phases decide from typed facts, never raw source strings):
 * the KV236 escape hatch must be recognized by symbol identity, not by a source-text name match.
 */
export function trustedHtmlBrandLocalNames(model: ComponentModuleModel): ReadonlySet<string> {
  const localNames = new Set<string>();
  for (const imported of model.namedImports) {
    const identity = frameworkExportForModuleSpecifier(
      imported.moduleSpecifier,
      imported.importedName,
    );
    if (expressionIdentityIsTrustedHtmlEscape(identity)) {
      localNames.add(imported.localName);
    }
  }
  return localNames;
}

/** @internal Whether an AST expression resolves to a trusted HTML brand helper. */
export function expressionResolvesToTrustedHtmlBrand(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  return expressionResolvesToAnyFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    TRUSTED_HTML_ESCAPE_EXPORTS,
  );
}

/** @internal Whether an AST expression resolves to the pure trustedHtml brand. */
export function expressionResolvesToTrustedHtmlPureBrand(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  return expressionResolvesToAnyFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    TRUSTED_HTML_PURE_BRAND_EXPORTS,
  );
}

/** @internal Whether an AST expression resolves to the pure trustedUrl brand. */
export function expressionResolvesToTrustedUrlPureBrand(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  return expressionResolvesToAnyFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    TRUSTED_URL_PURE_BRAND_EXPORTS,
  );
}

/** @internal Whether an AST expression resolves to the internal renderedHtml raw-HTML sink. */
export function expressionResolvesToRenderedHtmlRawSink(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  return expressionResolvesToAnyFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    RENDERED_HTML_RAW_SINK_EXPORTS,
  );
}

function expressionIdentityIsTrustedHtmlEscape(
  identity: ReturnType<typeof frameworkExportForModuleSpecifier>,
): boolean {
  return TRUSTED_HTML_ESCAPE_EXPORTS.some(
    (expected) =>
      identity?.module === expected.module && identity.exportName === expected.exportName,
  );
}

export function outputContextForAttribute(name: string): OutputContext {
  if (BOOLEAN_ATTRIBUTES.has(name)) return 'boolean-attribute';
  if (isUrlAttribute(name)) return 'url-attribute';
  if (name === 'style') return 'style-property';
  return 'attribute';
}

/**
 * @internal Canonical URL-attribute sink predicate shared by emit
 * (`outputContextForAttribute`) and the KV236 validator (`security/output-context.ts`)
 * so the rule-10 escaping decision and the gate that enforces it cannot diverge
 * (FN8, plans/compiler-refactoring.md; SPEC §5.2 rule 10).
 */
export function isUrlAttribute(name: string): boolean {
  return contextualOutputSinkFamilyForAttribute(name) === 'url';
}

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);
