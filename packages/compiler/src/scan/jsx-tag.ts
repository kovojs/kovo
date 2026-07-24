import ts from 'typescript';

// TypeScript lowers intrinsic JSX names to string tags when the first character is ASCII
// lowercase or the name contains a hyphen. Keep every scanner on that exact grammar so unusual
// JavaScript identifiers cannot bypass component invocation analysis (SPEC §5.2, §6.6).
export function isIntrinsicJsxTagName(tag: ts.JsxTagNameExpression): boolean {
  if (ts.isJsxNamespacedName(tag)) return true;
  if (!ts.isIdentifier(tag)) return false;
  const first = tag.text.charCodeAt(0);
  return (first >= 0x61 && first <= 0x7a) || tag.text.includes('-');
}
