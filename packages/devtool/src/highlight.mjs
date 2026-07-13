// Minimal, dependency-free TS/TSX syntax highlighter for code previews.
// Produces themed HTML spans (token classes styled in styles.css).
import {
  arrayLength,
  arrayMap,
  arrayValue,
  createSet,
  escapeHtmlText,
  isSafeInteger,
  joinStrings,
  regexpExec,
  regexpTest,
  setAdd,
  setHas,
  stringSlice,
  stringSplit,
} from './output-security.mjs';

const KEYWORDS = createSet();
const keywordValues = [
  'const',
  'let',
  'var',
  'export',
  'import',
  'from',
  'default',
  'async',
  'await',
  'return',
  'function',
  'if',
  'else',
  'for',
  'of',
  'in',
  'new',
  'type',
  'interface',
  'extends',
  'implements',
  'class',
  'as',
  'satisfies',
  'typeof',
  'keyof',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
  'null',
  'undefined',
  'true',
  'false',
  'void',
  'this',
  'super',
  'yield',
  'throw',
  'try',
  'catch',
  'finally',
  'switch',
  'case',
  'break',
  'continue',
  'do',
  'while',
  'enum',
  'namespace',
  'declare',
  'abstract',
];
for (let index = 0; index < arrayLength(keywordValues, 'devtool keyword vocabulary'); index += 1) {
  setAdd(KEYWORDS, arrayValue(keywordValues, index, 'devtool keyword vocabulary'));
}

const esc = escapeHtmlText;

const TOKEN = new RegExp(
  joinStrings(
    [
      '(\\/\\/[^\\n]*)',
      '(\\/\\*[\\s\\S]*?\\*\\/)',
      '(`(?:\\\\.|[^`\\\\])*`)',
      '("(?:\\\\.|[^"\\\\])*")',
      "('(?:\\\\.|[^'\\\\])*')",
      '(<\\/?[A-Za-z][\\w.-]*)',
      '(\\b\\d[\\d_.eExXa-fA-F]*\\b)',
      '([A-Za-z_$][\\w$]*)',
      '([{}()\\[\\].,;:?=&|!<>+\\-*/%@]+)',
    ],
    '|',
    'devtool tokenizer patterns',
  ),
  'g',
);

function highlightLine(line) {
  let out = '',
    last = 0,
    m;
  TOKEN.lastIndex = 0;
  while ((m = regexpExec(TOKEN, line))) {
    if (m.index > last) out += esc(stringSlice(line, last, m.index));
    const full = arrayValue(m, 0, 'devtool token match');
    const lineCom = arrayValue(m, 1, 'devtool token match');
    const blockCom = arrayValue(m, 2, 'devtool token match');
    const tpl = arrayValue(m, 3, 'devtool token match');
    const dq = arrayValue(m, 4, 'devtool token match');
    const sq = arrayValue(m, 5, 'devtool token match');
    const tag = arrayValue(m, 6, 'devtool token match');
    const num = arrayValue(m, 7, 'devtool token match');
    const ident = arrayValue(m, 8, 'devtool token match');
    if (lineCom || blockCom) out += `<span class="t-com">${esc(full)}</span>`;
    else if (tpl || dq || sq) out += `<span class="t-str">${esc(full)}</span>`;
    else if (tag) out += `<span class="t-tag">${esc(full)}</span>`;
    else if (num) out += `<span class="t-num">${esc(full)}</span>`;
    else if (ident) out += classifyIdent(ident, line, m.index + ident.length);
    else out += `<span class="t-punc">${esc(full)}</span>`;
    last = m.index + full.length;
  }
  if (last < line.length) out += esc(stringSlice(line, last));
  return out;
}

function classifyIdent(id, line, end) {
  if (setHas(KEYWORDS, id)) return `<span class="t-key">${esc(id)}</span>`;
  const rest = stringSlice(line, end);
  if (regexpTest(/^\s*\(/u, rest)) return `<span class="t-fn">${esc(id)}</span>`;
  if (regexpTest(/^[A-Z]/u, id)) return `<span class="t-type">${esc(id)}</span>`;
  if (regexpTest(/^\s*[:=]/u, rest) || regexpTest(/\.\s*$/u, stringSlice(line, 0, end - id.length)))
    return `<span class="t-prop">${esc(id)}</span>`;
  return esc(id);
}

/** Render a source slice into a gutter-numbered, syntax-highlighted <pre>. */
export function renderCode(slice) {
  if (
    typeof slice?.code !== 'string' ||
    typeof slice.file !== 'string' ||
    typeof slice.lang !== 'string' ||
    !isSafeInteger(slice.startLine) ||
    !isSafeInteger(slice.anchorLine) ||
    !isSafeInteger(slice.endLine) ||
    slice.startLine < 1 ||
    slice.anchorLine < slice.startLine ||
    slice.endLine < slice.anchorLine
  ) {
    throw new TypeError('Kovo devtool source slice must use text and a valid positive line range.');
  }
  const rows = joinStrings(
    arrayMap(
      stringSplit(slice.code, '\n'),
      (line, i) => {
        const ln = slice.startLine + i;
        const isAnchor = ln === slice.anchorLine;
        return (
          `<div class="ln${isAnchor ? ' anchor' : ''}"><span class="gut">${ln}</span>` +
          `<span class="cd">${highlightLine(line) || '&nbsp;'}</span></div>`
        );
      },
      'devtool source lines',
    ),
    '',
    'devtool highlighted rows',
  );
  return (
    `<div class="code"><div class="code-head"><span class="path">${esc(slice.file)}</span>` +
    `<span class="lang">${esc(slice.lang)}</span><span class="lines">L${slice.startLine}–${slice.endLine}</span></div>` +
    `<pre class="src">${rows}</pre></div>`
  );
}
