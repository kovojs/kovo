// @kovo-security-classifier-corpus capability-closure
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { build as viteBuild } from 'vite-plus';

import { dependencyCapabilityLoaderVitePlugin } from './dependency-capability-loader.js';

const wideMemberCount = 1_600;
const repeatedTransferCount = 64;
// Stable path identities keep this below KV448's finite-work budget; treating every use as a fresh
// identity exhausts that budget and is enrolled as a release-gate mutant (SPEC §6.6).
const repeatedAliasTransferCount = 7_500;

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

function provenanceChurnedStructuredTransfers(name: string): string {
  return Array.from(
    { length: repeatedTransferCount },
    (_, index) =>
      `Object.assign(target, { get: ${name} }); target.p${index} = { value: ${index} };`,
  ).join('\n');
}

function repeatedAliasTransfers(name: string): string {
  return Array.from({ length: repeatedAliasTransferCount }, () => `unknownSink(${name});`).join(
    '\n',
  );
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

async function buildOwnedClientChunks(appSource: string, sharedSource: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-browser-owned-chunk-opacity-')));
  const appModulePath = join(root, 'app.mjs');
  const sharedModulePath = join(root, 'shared.mjs');
  const outDir = join(root, 'dist');
  try {
    writeFileSync(appModulePath, appSource);
    writeFileSync(sharedModulePath, sharedSource);
    await viteBuild({
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          input: { app: appModulePath, shared: sharedModulePath },
          output: { entryFileNames: '[name].mjs' },
          preserveEntrySignatures: 'strict',
        },
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          [
            { fileName: 'app.mjs', source: appSource },
            { fileName: 'shared.mjs', source: sharedSource },
          ],
          { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
          'build-client',
        ),
      ],
      root,
    });
    return readFileSync(join(outDir, 'app.mjs'), 'utf8');
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

  // @kovo-security-certifies C13 dependency-browser-opacity-stable-provenance-batch
  it('admits a repeated wide safe closure across unrelated assignment provenance', async () => {
    const source = `${wideSafeClosure('wideSafe')}
const target = {};
${provenanceChurnedStructuredTransfers('wideSafe')}
export const inspect = () => ['classifier-churn-ok', target.get(), target.p63];`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('classifier-churn-ok');
    expect(artifact).toContain('target.p63');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-stable-binding-memo
  it('admits a repeated safe closure through one stable binding', async () => {
    const source = `${wideSafeClosure('wideSafe')}
${repeatedAliasTransfers('wideSafe')}
export const inspect = () => 'binding-memo-ok';`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('binding-memo-ok');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-inline-closure-capture
  it('closes a captured object transferred through an inline closure', async () => {
    const source = `const box = {};
unknownSink(() => box);
export const inspect = () => new box.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-nested-return-capture
  it('closes captures behind a local callable returned into an opaque container', async () => {
    const source = `const box = {};
function inner() { return box; }
function outer() { return inner; }
unknownSink([outer()]);
export const inspect = () => new box.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-direct-call-cache-invalidation
  it('invalidates a direct local-callee summary after prototype replacement', async () => {
    const source = `const box = {};
function local(_value) { return 1; }
unknownSink([local({})]);
local.__proto__ = {};
export const result = local(box);
export const inspect = () => [result, new box.platform.Worker('/payload.mjs')];`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-first-call-opaque-constructor
  it('closes a first direct local call after prototype replacement', async () => {
    const source = `const box = {};
function local(_value) { return 1; }
local.__proto__ = {};
export const result = local(box);
export const inspect = () => [result, new box.platform.Worker('/payload.mjs')];`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-returned-function-self
  it('closes a named local function returned through its self binding', async () => {
    const source = `const local = function self() { return self; };
unknownSink([local()]);
export const inspect = () => new local.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-module-meta
  it('closes mutable import.meta after an opaque structured transfer', async () => {
    const source = `unknownSink(import.meta);
export const inspect = () => 'module-meta-transfer-closed';`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-module-meta-return
  it('closes import.meta returned through a summarized local callable', async () => {
    const source = `function expose() { return import.meta; }
unknownSink([expose()]);
export const inspect = () => 'module-meta-return-closed';`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-module-meta-member-alias
  it('closes an aliased mutable member of import.meta', async () => {
    const source = `import.meta.shared = {};
const shared = import.meta.shared;
unknownSink(shared);
export const inspect = () => 'module-meta-member-closed';`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  it('admits the primitive import.meta.url projection through an opaque call', async () => {
    const source = `unknownSink(import.meta.url);
export const inspect = () => 'module-meta-url-ok';`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('module-meta-url-ok');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-unresolved-global
  it('closes an unresolved global after an opaque structured transfer', async () => {
    const source = `unknownSink(externalGlobal);
export const inspect = () => new externalGlobal.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-unresolved-global-member
  it('retains unresolved-global origin through an opaque member transfer', async () => {
    const source = `unknownSink(externalGlobal.shared);
export const inspect = () => new externalGlobal.shared.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-unresolved-global-return
  it('closes an unresolved global returned through a summarized local callable', async () => {
    const source = `function expose() { return externalGlobal; }
unknownSink([expose()]);
export const inspect = () => new externalGlobal.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-syntax-key-not-global
  it('does not treat a class method key as an unresolved global capture', async () => {
    const source = `const Local = class { constructor() {} };
unknownSink(Local);
export const inspect = () => new Map().size;`;

    const artifact = await buildReviewedClientArtifact(source);
    expect(artifact).toContain('new Map');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-owned-chunk-import
  it('closes a mutable binding retained across owned client chunks', async () => {
    const appSource = `import { shared } from './shared.mjs';
unknownSink(shared);
export const inspect = () => new shared.platform.Worker('/payload.mjs');`;
    await expect(buildOwnedClientChunks(appSource, 'export const shared = {};')).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-owned-chunk-import-variants
  it.each([
    [
      'default',
      `import shared from './shared.mjs';
unknownSink(shared);
export const inspect = () => new shared.platform.Worker('/payload.mjs');`,
      'const shared = {}; export default shared;',
    ],
    [
      'namespace member',
      `import * as sharedModule from './shared.mjs';
unknownSink(sharedModule.shared);
export const inspect = () => new sharedModule.shared.platform.Worker('/payload.mjs');`,
      'export const shared = {};',
    ],
  ])(
    'closes a retained %s binding across owned client chunks',
    async (_kind, appSource, sharedSource) => {
      await expect(buildOwnedClientChunks(appSource, sharedSource)).rejects.toThrow(
        /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
      );
    },
  );

  // @kovo-security-certifies C13 dependency-browser-opacity-owned-chunk-positive-control
  it('retains plain compatibility for an unexposed owned-chunk binding', async () => {
    const appSource = `import { shared } from './shared.mjs';
export const inspect = () => new shared.Worker().kind;`;
    const sharedSource = `export const shared = {
  Worker: class LocalWorker { constructor() { this.kind = 'owned-chunk-local'; } },
};`;

    const artifact = await buildOwnedClientChunks(appSource, sharedSource);
    expect(artifact).toContain('new shared.Worker');
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-owned-chunk-call-result
  it('closes an opaque imported-call result that can alias another live chunk export', async () => {
    const appSource = `import { expose, shared } from './shared.mjs';
unknownSink(expose());
export const inspect = () => new shared.platform.Worker('/payload.mjs');`;
    const sharedSource = `export const shared = {};
export function expose() { return shared; }`;

    await expect(buildOwnedClientChunks(appSource, sharedSource)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-owned-chunk-constructor-result
  it('closes an opaque imported-constructor result that can alias another export', async () => {
    const appSource = `import { Expose, shared } from './shared.mjs';
unknownSink(new Expose());
export const inspect = () => new shared.platform.Worker('/payload.mjs');`;
    const sharedSource = `export const shared = {};
export class Expose { constructor() { return shared; } }`;

    await expect(buildOwnedClientChunks(appSource, sharedSource)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-opacity-late-member-alias
  it('closes a member write whose receiver is resolved by a later alias source', async () => {
    const source = `const box = {};
const poison = {};
unknownEffect(poison);
let alias;
function install() { alias.platform = poison; }
alias = box;
install();
export const inspect = () => new box.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
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

  // @kovo-security-certifies C13 dependency-browser-opacity-mode-separation
  it('distinguishes a value-only callable summary from whole-closure inspection', async () => {
    const source = `const box = {};
const carrier = {
  get: function capture() {
    return box;
  },
};
const selected = carrier.get;
const target = {};
Object.assign({}, carrier);
Object.assign(target, { get: selected });
export const inspect = () => new box.platform.Worker('/payload.mjs');`;

    await expect(buildReviewedClientArtifact(source)).rejects.toThrow(
      /KV448.*(?:opaque browser executable carrier|Worker constructor)/u,
    );
  });
});
