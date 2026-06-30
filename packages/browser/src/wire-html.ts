import { readWireElementAttribute, tagClose, unescapeHtml } from './wire-tokenizer.js';

export { tagClose, unescapeHtml };

export function readAttribute(attrs: string, name: string): string | null {
  const attribute = readWireElementAttribute(attrs, name);
  return attribute.present && attribute.value ? attribute.value : null;
}
