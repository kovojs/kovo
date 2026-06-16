import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateApiReference } from './api-ref.mjs';
import { captureAll } from './capture.mjs';
import { generateDiagnosticsReference } from './diagnostics-ref.mjs';

/**
 * Content pre-pass for the Kovo docs app. The app (src/app.ts) is a pure Kovo
 * app: it must not run the compiler/CLI at SSR or export time. This script
 * produces the toolchain-driven inputs the app reads as plain data:
 *   - gen/api/*.md         generated public API reference (W6)
 *   - gen/reference/*.md   generated diagnostics catalog
 *   - gen/captures.json    real compiler/CLI/loader output (W3 — fails on drift)
 * Tutorial snippets (W5) are pure file extraction and are read directly by the
 * app (content.ts); only the toolchain-driven captures are materialized here.
 * Every value comes from the real toolchain each run, so embedded output cannot
 * drift from the framework (SPEC Constitution #3, #4).
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const genDir = path.join(siteRoot, 'gen');

/** Map captureAll() output to the {{capture:name}} substitution values the
 * content pages use, matching the keys content.ts reads. */
function captureValues(captures) {
  return {
    'loader-gzip-bytes': String(captures.loader.gzipBytes),
    'lowering-client': `\`\`\`js\n${captures.lowering.client}\n\`\`\``,
    'lowering-input': `\`\`\`tsx\n${captures.lowering.input}\n\`\`\``,
    'lowering-lint': captures.lowering.lint,
    'lowering-server': `\`\`\`js\n${captures.lowering.server}\n\`\`\``,
  };
}

export async function runContentPipeline() {
  await generateApiReference();
  await generateDiagnosticsReference();
  await mkdir(genDir, { recursive: true });

  const captures = await captureAll(repoRoot);

  await writeFile(
    path.join(genDir, 'captures.json'),
    `${JSON.stringify(captureValues(captures), null, 2)}\n`,
    'utf8',
  );

  return { captures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runContentPipeline();
  process.stdout.write('content-pipeline/v1\nOK\n');
}
