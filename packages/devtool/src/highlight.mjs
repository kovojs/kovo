// Minimal, dependency-free TS/TSX syntax highlighter for code previews.
// Produces themed HTML spans (token classes styled in styles.css).

const KEYWORDS = new Set([
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
]);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = new RegExp(
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
  ].join('|'),
  'g',
);

function highlightLine(line) {
  let out = '',
    last = 0,
    m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out += esc(line.slice(last, m.index));
    const [full, lineCom, blockCom, tpl, dq, sq, tag, num, ident] = m;
    if (lineCom || blockCom) out += `<span class="t-com">${esc(full)}</span>`;
    else if (tpl || dq || sq) out += `<span class="t-str">${esc(full)}</span>`;
    else if (tag) out += `<span class="t-tag">${esc(full)}</span>`;
    else if (num) out += `<span class="t-num">${esc(full)}</span>`;
    else if (ident) out += classifyIdent(ident, line, m.index + ident.length);
    else out += `<span class="t-punc">${esc(full)}</span>`;
    last = m.index + full.length;
  }
  if (last < line.length) out += esc(line.slice(last));
  return out;
}

function classifyIdent(id, line, end) {
  if (KEYWORDS.has(id)) return `<span class="t-key">${id}</span>`;
  const rest = line.slice(end);
  if (/^\s*\(/.test(rest)) return `<span class="t-fn">${esc(id)}</span>`;
  if (/^[A-Z]/.test(id)) return `<span class="t-type">${esc(id)}</span>`;
  if (/^\s*[:=]/.test(rest) || /\.\s*$/.test(line.slice(0, end - id.length)))
    return `<span class="t-prop">${esc(id)}</span>`;
  return esc(id);
}

/** Render a source slice into a gutter-numbered, syntax-highlighted <pre>. */
export function renderCode(slice) {
  const rows = slice.code
    .split('\n')
    .map((line, i) => {
      const ln = slice.startLine + i;
      const isAnchor = ln === slice.anchorLine;
      return (
        `<div class="ln${isAnchor ? ' anchor' : ''}"><span class="gut">${ln}</span>` +
        `<span class="cd">${highlightLine(line) || '&nbsp;'}</span></div>`
      );
    })
    .join('');
  return (
    `<div class="code"><div class="code-head"><span class="path">${esc(slice.file)}</span>` +
    `<span class="lang">${esc(slice.lang)}</span><span class="lines">L${slice.startLine}–${slice.endLine}</span></div>` +
    `<pre class="src">${rows}</pre></div>`
  );
}
