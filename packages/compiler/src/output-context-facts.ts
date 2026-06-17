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

export interface GeneratedOutputWriteFact {
  context: OutputContext;
  expression?: string;
  sink: string;
  source: 'client-query' | 'client-state' | 'server-render' | 'style-extraction' | 'template-stamp';
  writer: string;
}

export function outputContextForAttribute(name: string): OutputContext {
  if (BOOLEAN_ATTRIBUTES.has(name)) return 'boolean-attribute';
  if (URL_ATTRIBUTES.has(name.toLowerCase())) return 'url-attribute';
  if (name === 'style') return 'style-property';
  return 'attribute';
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
