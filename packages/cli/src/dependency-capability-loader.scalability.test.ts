// @kovo-security-classifier-corpus capability-closure
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { build as viteBuild } from 'vite-plus';

import { dependencyCapabilityLoaderVitePlugin } from './dependency-capability-loader.js';

const wideMemberCount = 1_600;
const repeatedTransferCount = 64;

function wideSafeClosure(name: string, shadowAmbientAuthority = false): string {
  const shadowedBindings = shadowAmbientAuthority
    ? 'const Reflect = { construct(target, args) { return [target, args]; } }; class URL {}'
    : '';
  const returnedValues = Array.from(
    { length: wideMemberCount },
    (_, index) => `value.p${index}`,
  ).join(',');
  const shadowedValues = shadowAmbientAuthority ? 'Reflect.construct, URL, ' : '';
  return `function ${name}(value) { ${shadowedBindings} return [${shadowedValues}${returnedValues}]; }`;
}

function repeatedStructuredTransfers(name: string): string {
  return Array.from(
    { length: repeatedTransferCount },
    () => `Object.assign(target, { get: ${name} });`,
  ).join('\n');
}

async function buildReviewedClientArtifact(source: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-browser-opacity-scale-')));
  const appModulePath = join(root, 'app.mjs');
  const outDir = join(root, 'dist');
  try {
    writeFileSync(appModulePath, source);
    await viteBuild({
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          input: appModulePath,
          output: { entryFileNames: 'entry.js' },
          preserveEntrySignatures: 'strict',
        },
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          [{ fileName: 'app.mjs', source }],
          { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
          'build-client',
        ),
      ],
      root,
    });
    return readFileSync(join(outDir, 'entry.js'), 'utf8');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe('SPEC §6.6 browser structured-opacity scalability', () => {
  // @kovo-security-certifies C13 dependency-browser-opacity-finite-summary
  it('admits a wide safe closure transferred repeatedly through structured arguments', async () => {
    const source = `${wideSafeClosure('wideSafe')}
const target = {};
${repeatedStructuredTransfers('wideSafe')}
export const inspect = () => ['classifier-scale-ok', target.get()];`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('classifier-scale-ok');
    expect(artifact).toContain('Object.assign');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-poison-first
  it('keeps a poison transferred before repeated safe closures closed', async () => {
    const source = `${wideSafeClosure('wideSafe')}
function poison() { return Reflect.construct(URL, ['./payload.mjs', import.meta.url]); }
let selected = poison;
function shared(value) { return selected(value); }
const target = {};
Object.assign(target, { get: shared });
selected = wideSafe;
${repeatedStructuredTransfers('shared')}
export const inspect = () => target.get();`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|opaque new-URL)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-poison-late
  it('replays a shared structured value after a late graph poison', async () => {
    const source = `const box = {};
let selected = {};
const holder = [selected];
Object.assign({}, holder);
selected = box;
Object.assign({}, holder);
export const inspect = () => new box.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-shadowed-authority
  it('keeps memoized closure inspection lexical when ambient authority names are shadowed', async () => {
    const source = `${wideSafeClosure('wideShadowed', true)}
const target = {};
${repeatedStructuredTransfers('wideShadowed')}
export const inspect = () => ['shadowed-scale-ok', target.get()];`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('class URL');
    expect(artifact).toContain('Reflect');
    expect(artifact).toContain('shadowed-scale-ok');
  });
});
