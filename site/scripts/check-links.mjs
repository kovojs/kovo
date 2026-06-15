import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Link + anchor gate (plan W9): every internal href in the exported site must
 * resolve to a file, and every #fragment must match an id on the target page.
 * External links are recorded, not fetched (the gate runs offline).
 */

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

// Embedded example apps (dist/examples/<name>/app/**) are self-contained static
// exports with their own link semantics — including intentionally-unexported
// in-app routes (e.g. commerce's /products pagination link). They are not docs
// pages, so the docs link/anchor gate skips them.
const EMBEDDED_APP = /(?:^|\/)examples\/[^/]+\/app(?:\/|$)/;

async function htmlFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(distDir, full).split(path.sep).join('/');
    if (EMBEDDED_APP.test(relative)) continue;
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

function pageIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

function pageLinks(html) {
  // Highlighted code samples (tutorial snippets, captures) can contain
  // literal href= text; only real document links are checkable.
  const withoutCode = html.replace(/<pre[\s\S]*?<\/pre>/g, '');
  return [...withoutCode.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1]);
}

function targetFor(urlPath) {
  const clean = urlPath.split('?')[0].replace(/^\//, '');
  if (clean === '') return path.join(distDir, 'index.html');
  if (clean.endsWith('/')) return path.join(distDir, clean, 'index.html');
  if (path.extname(clean)) return path.join(distDir, clean);
  return path.join(distDir, clean, 'index.html');
}

async function main() {
  if (!existsSync(distDir)) throw new Error('check-links: dist/ missing — build the site first');

  const files = await htmlFiles(distDir);
  const idsByTarget = new Map();
  for (const file of files) idsByTarget.set(file, pageIds(await readFile(file, 'utf8')));

  const failures = [];
  let internal = 0;
  let external = 0;

  for (const file of files) {
    const html = await readFile(file, 'utf8');
    for (const href of pageLinks(html)) {
      if (/^(https?:|mailto:|data:)/.test(href)) {
        external += 1;
        continue;
      }
      internal += 1;
      const [urlPath, fragment] = href.split('#');
      const relative = path.relative(distDir, file);

      if (urlPath && !urlPath.startsWith('/')) {
        failures.push(`${relative}: non-absolute internal href "${href}"`);
        continue;
      }

      const target = urlPath ? targetFor(urlPath) : file;
      if (!existsSync(target)) {
        failures.push(`${relative}: broken link "${href}"`);
        continue;
      }

      if (fragment && target.endsWith('.html')) {
        const ids = idsByTarget.get(target) ?? pageIds(await readFile(target, 'utf8'));
        idsByTarget.set(target, ids);
        if (!ids.has(fragment)) {
          failures.push(`${relative}: broken anchor "${href}"`);
        }
      }
    }
  }

  // llms.txt mirrors must resolve as files under dist/.
  const llms = await readFile(path.join(distDir, 'llms.txt'), 'utf8');
  for (const [, mirror] of llms.matchAll(/\(https:\/\/[^/]+(\/[^)]+)\)/g)) {
    if (!existsSync(path.join(distDir, mirror.replace(/^\//, '')))) {
      failures.push(`llms.txt: missing mirror "${mirror}"`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`check-links/v1\n${failures.join('\n')}\nFAIL total=${failures.length}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `check-links/v1\npages=${files.length} internal=${internal} external=${external}\nOK\n`,
  );
}

await main();
