import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { documentedApiEntries } from './api-ref.mjs';

/**
 * `@example` typecheck gate (plan Goal 2): every `@example` block in the
 * generated API reference must compile against the real workspace `@kovojs/*`
 * packages, so the refs cannot lie. Mirrors the tutorial's
 * `extract-snippets.mjs` + `run-steps.mjs`: extract → write → typecheck.
 *
 * The generator (`api-ref.mjs`) renders each `@example` as a fenced `ts` block
 * immediately after an `**Example**` marker. We extract exactly those blocks
 * (never the type-signature fences), write one `.ts` file per example into a
 * scratch dir inside the repo (so `@kovojs/*` resolve through the workspace), and
 * run `tsgo` once over all of them. Determinism: scratch files are derived only
 * from the markdown; no timestamps or absolute paths leak into them.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const apiDir = path.join(siteRoot, 'gen/api');
const scratchDir = path.join(siteRoot, 'gen/api-examples');
const stepsTsconfig = path.join(siteRoot, 'tutorial/tsconfig.steps.json');

/** Extract `@example` ts blocks from one generated page. A block counts only
 * when its fence is the first non-blank line after an `**Example**` marker, so
 * the signature fences are never mistaken for examples. */
export function extractExampleBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== '**Example**') continue;

    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
    if (cursor >= lines.length || lines[cursor].trim() !== '```ts') continue;

    const body = [];
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() !== '```') {
      body.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push(body.join('\n'));
    index = cursor;
  }
  return blocks;
}

/** Map of `<page>:<heading>#<n>` → example source over every generated page. */
export function collectApiExamples(dir = apiDir, publicPages = publicApiPageFiles()) {
  const allowedPages = new Set(publicPages);
  const examples = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    if (!allowedPages.has(file)) continue;
    const markdown = readFileSync(path.join(dir, file), 'utf8');
    const lines = markdown.split('\n');
    const slug = file.replace(/\.md$/, '');

    // Track the current symbol heading so example file names are stable & meaningful.
    let heading = 'page';
    let perHeading = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const headingMatch = /^#{3,4} `(.+)`$/.exec(lines[index]);
      if (headingMatch) {
        heading = headingMatch[1];
        perHeading = 0;
        continue;
      }
      if (lines[index].trim() !== '**Example**') continue;

      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
      if (cursor >= lines.length || lines[cursor].trim() !== '```ts') continue;

      const body = [];
      cursor += 1;
      while (cursor < lines.length && lines[cursor].trim() !== '```') {
        body.push(lines[cursor]);
        cursor += 1;
      }
      perHeading += 1;
      examples.push({
        code: body.join('\n'),
        id: `${slug}__${sanitize(heading)}__${perHeading}`,
      });
      index = cursor;
    }
  }
  return examples;
}

function sanitize(name) {
  return name.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}

function publicApiPageFiles() {
  return documentedApiEntries().map((entry) => `${entry.slug}.md`);
}

async function main() {
  if (!existsSync(apiDir)) {
    throw new Error(
      `api-examples: ${path.relative(repoRoot, apiDir)} missing — run \`node site/scripts/api-ref.mjs\` first`,
    );
  }

  const examples = collectApiExamples();
  if (examples.length === 0) {
    throw new Error('api-examples: no @example blocks found in the generated API reference');
  }

  await rm(scratchDir, { force: true, recursive: true });
  await mkdir(scratchDir, { recursive: true });

  for (const example of examples) {
    await writeFile(path.join(scratchDir, `${example.id}.ts`), `${example.code}\n`, 'utf8');
  }

  // Drizzle is not symlinked under site/node_modules; map it to its source so
  // `@kovojs/drizzle` examples resolve like the others (the rest resolve via the
  // workspace node_modules). Reuse the tutorial step compiler options verbatim.
  const tsconfig = {
    compilerOptions: {
      paths: { '@kovojs/drizzle': ['../../../packages/drizzle/src/runtime.ts'] },
    },
    extends: path.relative(scratchDir, stepsTsconfig),
    include: ['*.ts'],
  };
  await writeFile(
    path.join(scratchDir, 'tsconfig.json'),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    'utf8',
  );

  try {
    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/tsgo'),
      ['-p', path.join(scratchDir, 'tsconfig.json')],
      { cwd: repoRoot, stdio: 'inherit' },
    );
  } catch {
    // tsgo already printed the diagnostics (stdio: inherit); leave the scratch
    // dir in place so the failing files can be inspected.
    process.stdout.write(
      `\napi-examples/v1 examples=${examples.length} FAILED — see diagnostics above; scratch in ${path.relative(repoRoot, scratchDir)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Clean up on success so the scratch dir is not committed.
  rmSync(scratchDir, { force: true, recursive: true });
  process.stdout.write(
    `api-examples/v1 examples=${examples.length} OK\napi-examples/v1 all @example blocks typecheck against @kovojs/*\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
