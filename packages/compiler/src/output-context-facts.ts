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
  return URL_ATTRIBUTES.has(name.toLowerCase());
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

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'ping',
  'xlink:href',
]);
