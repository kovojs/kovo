import { isUrlAttributeName } from '@kovojs/core/internal/security-url';

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
const TRUSTED_HTML_BRAND_MODULE = '@kovojs/browser';
const TRUSTED_HTML_BRAND_EXPORTS = new Set(['trustedHtml', 'safeRichHtml']);

/**
 * @internal The local identifiers in this module that are bound to the REAL trusted-HTML brand
 * exports of `@kovojs/browser`, resolved from typed import facts (`model.namedImports`).
 *
 * SPEC §6.6(1) ("classification is carried by AST symbol-identity provenance … never [a] text
 * heuristic") and §5.2 rule 9 (post-parse phases decide from typed facts, never raw source strings):
 * the KV236 escape hatch must be recognized by symbol identity, not by a source-text name match. A
 * local `const trustedHtml = …` (shadow), a same-named import from another module, or an aliased
 * binding is therefore NOT a brand and cannot suppress KV236 (fail-closed); an aliased import of the
 * real export (`import { trustedHtml as th }`) IS, because its local name resolves through the import.
 */
export function trustedHtmlBrandLocalNames(model: ComponentModuleModel): ReadonlySet<string> {
  const localNames = new Set<string>();
  for (const imported of model.namedImports) {
    if (
      imported.moduleSpecifier === TRUSTED_HTML_BRAND_MODULE &&
      TRUSTED_HTML_BRAND_EXPORTS.has(imported.importedName)
    ) {
      localNames.add(imported.localName);
    }
  }
  return localNames;
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
  return isUrlAttributeName(name);
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
