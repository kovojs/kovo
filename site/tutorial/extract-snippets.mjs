import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tutorial snippet extraction (plan W5): chapter code blocks are extracted
 * from the checked-in step states, never hand-written, so prose cannot drift
 * from code that compiles and tests in CI. Step sources mark regions with
 * `// snippet:<marker>` … `// /snippet` fences; chapters reference them as
 * {{snippet:<step>/<path>#<marker>}}. A missing file, marker, or unbalanced
 * fence throws — the site build fails rather than shipping a stale snippet.
 */

const SNIPPET_OPEN = /^\s*\/\/ snippet:([\w-]+)\s*$/;
const SNIPPET_CLOSE = /^\s*\/\/ \/snippet\s*$/;
const SNIPPET_EXTENSIONS = new Map([
  ['.js', 'js'],
  ['.json', 'json'],
  ['.mjs', 'js'],
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
]);

export const defaultStepsDir = fileURLToPath(new URL('steps/', import.meta.url));

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

function dedent(lines) {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(indent));
}

function extractFileSnippets(file, relativePath, snippets) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let open = null;
  let buffer = [];

  for (const [index, line] of lines.entries()) {
    const at = `${relativePath}:${index + 1}`;
    const opened = SNIPPET_OPEN.exec(line);
    if (opened) {
      if (open) throw new Error(`snippets: nested snippet fence at ${at} (inside "${open}")`);
      open = opened[1];
      buffer = [];
      continue;
    }
    if (SNIPPET_CLOSE.test(line)) {
      if (!open) throw new Error(`snippets: stray closing fence at ${at}`);
      const key = `${relativePath}#${open}`;
      if (snippets.has(key)) throw new Error(`snippets: duplicate marker "${key}"`);
      snippets.set(key, {
        code: dedent(buffer).join('\n').trimEnd(),
        lang: SNIPPET_EXTENSIONS.get(path.extname(file)) ?? 'ts',
      });
      open = null;
      continue;
    }
    if (open) buffer.push(line);
  }

  if (open) throw new Error(`snippets: unclosed snippet fence "${open}" in ${relativePath}`);
}

/** Map of `<step>/<path>#<marker>` → { code, lang } over every step source. */
export function loadTutorialSnippets(stepsDir = defaultStepsDir) {
  const snippets = new Map();
  for (const file of walkFiles(stepsDir)) {
    if (!SNIPPET_EXTENSIONS.has(path.extname(file))) continue;
    extractFileSnippets(file, path.relative(stepsDir, file).split(path.sep).join('/'), snippets);
  }
  return snippets;
}

/** List the {{snippet:…}} references a markdown body makes. */
export function listSnippetReferences(body) {
  return [...body.matchAll(/\{\{snippet:([^}]+)\}\}/g)].map((match) => match[1]);
}

/** Replace {{snippet:…}} references with fenced code blocks; unknown → throw. */
export function substituteSnippets(body, snippets) {
  return body.replace(/\{\{snippet:([^}]+)\}\}/g, (_match, reference) => {
    const snippet = snippets.get(reference);
    if (!snippet) throw new Error(`build: unknown tutorial snippet "${reference}"`);
    return `\`\`\`${snippet.lang}\n${snippet.code}\n\`\`\``;
  });
}
