import { Marked } from 'marked';
import { createHighlighter } from 'shiki';

/**
 * Markdown pipeline (plan W2): frontmatter + marked + shiki at build time,
 * stable heading anchors, and SPEC § citations auto-linked to /spec.
 * Site-local build tooling by decision — not framework surface.
 */

const SHIKI_LANGS = ['ts', 'tsx', 'js', 'jsx', 'html', 'css', 'json', 'sh', 'http', 'diff'];
const SHIKI_THEME = 'github-dark-default';

let highlighterPromise;

function highlighter() {
  highlighterPromise ??= createHighlighter({ langs: SHIKI_LANGS, themes: [SHIKI_THEME] });
  return highlighterPromise;
}

export function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) return { body: source, data: {} };
  const end = source.indexOf('\n---', 4);
  if (end === -1) return { body: source, data: {} };

  const data = {};
  for (const line of source.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
    if (/^\d+$/.test(value)) value = Number(value);
    data[key] = value;
  }

  return { body: source.slice(end + 4).replace(/^\n/, ''), data };
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** SPEC headings like "### 6.4 Routes & links" get number-derived anchors (6-4). */
export function specHeadingId(rawText) {
  const numbered = /^(?:Appendix\s+([A-Z])|(\d+(?:\.\d+)*))[.:]?\s/.exec(rawText.trim());
  if (!numbered) return slugify(rawText);
  if (numbered[1]) return `appendix-${numbered[1].toLowerCase()}`;
  return numbered[2].replaceAll('.', '-');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Inline extension linking "SPEC §6.4" / "§6.4" citations to /spec anchors. */
const specCitation = {
  name: 'specCitation',
  level: 'inline',
  start(src) {
    const index = src.search(/(?:SPEC\s*)?§/);
    return index === -1 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^(SPEC\s*)?§(\d+(?:\.\d+)*)/.exec(src);
    if (!match) return undefined;
    return {
      type: 'specCitation',
      raw: match[0],
      prefix: match[1] ?? '',
      section: match[2],
    };
  },
  renderer(token) {
    const anchor = token.section.replaceAll('.', '-');
    const label = `${token.prefix ? 'SPEC ' : ''}§${token.section}`;
    return `<a class="spec-chip" href="/spec/#${anchor}">${label}</a>`;
  },
};

/** Code blocks render as designed windows: title bar (optional
 * `title="..."` in the fence info string), language badge, copy button.
 * The copy button is a Kovo island — no JS loads until first click. */
function codeWindow({ highlighted, language, title }) {
  const bar = [
    `<span class="code-window-title">${title ? escapeHtml(title) : ''}</span>`,
    language === 'txt' ? '' : `<span class="code-window-lang">${language}</span>`,
    '<button type="button" class="code-copy" on:click="/c/code.js#copy">Copy</button>',
  ].join('');
  return `<figure class="code-window"><div class="code-window-bar">${bar}</div>${highlighted}</figure>`;
}

function plainText(tokens, collected = []) {
  for (const token of tokens ?? []) {
    if (token.type === 'code') continue;
    if (token.text && !token.tokens) collected.push(token.text);
    if (token.tokens) plainText(token.tokens, collected);
    if (token.items) for (const item of token.items) plainText(item.tokens, collected);
    if (token.rows) {
      for (const row of token.rows) for (const cell of row) plainText(cell.tokens, collected);
    }
    if (token.header) for (const cell of token.header) plainText(cell.tokens, collected);
  }
  return collected;
}

/**
 * Render one markdown document.
 * Returns { html, headings, title, text } — headings carry stable ids for the
 * sidebar, the W9 anchor checker, and the W8 search index.
 */
export async function renderMarkdown(body, { anchorStyle = 'slug' } = {}) {
  const shiki = await highlighter();
  const headings = [];
  const seen = new Map();

  const marked = new Marked();
  marked.use({ extensions: [specCitation] });
  marked.use({
    renderer: {
      code({ text, lang }) {
        const info = (lang ?? '').trim();
        const [first = '', ...rest] = info.split(/\s+/);
        const language = SHIKI_LANGS.includes(first) ? first : 'txt';
        const title = /title="([^"]*)"/.exec(rest.join(' '))?.[1] ?? '';
        const highlighted =
          language === 'txt'
            ? `<pre class="shiki"><code>${escapeHtml(text)}</code></pre>`
            : shiki.codeToHtml(text, { lang: language, theme: SHIKI_THEME });
        return codeWindow({ highlighted, language, title });
      },
      heading({ tokens, depth, raw }) {
        const inline = this.parser.parseInline(tokens);
        const rawText = raw.replace(/^#+\s*/, '').trim();
        let id = anchorStyle === 'spec' ? specHeadingId(rawText) : slugify(rawText);
        const count = seen.get(id) ?? 0;
        seen.set(id, count + 1);
        if (count > 0) id = `${id}-${count}`;
        headings.push({ depth, id, text: rawText });
        const anchor =
          depth > 1
            ? `<a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeHtml(rawText)}">#</a>`
            : '';
        return `<h${depth} id="${id}">${inline}${anchor}</h${depth}>\n`;
      },
    },
  });

  const tokens = marked.lexer(body);
  const text = plainText(tokens).join(' ').replace(/\s+/g, ' ').trim();
  const html = marked.parser(tokens);
  const title = headings.find((heading) => heading.depth === 1)?.text ?? headings[0]?.text ?? '';

  return { headings, html, text, title };
}
