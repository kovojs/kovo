import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('published Vite compiler authority', () => {
  it('links genuine lowering before late or sibling-preloaded authored resolver hooks', () => {
    const root = mkdtempSync(join(compilerRoot, '.tmp-vite-config-authority-'));
    const outDir = join(root, 'dist');
    const installHookPath = join(root, 'install-hook.mjs');
    const preloadPath = join(root, 'workspace-source-resolver.mjs');
    const prehookProbePath = join(root, 'prehook-probe.mjs');
    const probePath = join(root, 'probe.mjs');
    const siblingProbePath = join(root, 'sibling-probe.mjs');

    try {
      const build = spawnSync(
        'pnpm',
        [
          'exec',
          'vp',
          'pack',
          'src/vite-config.ts',
          '--no-config',
          '--out-dir',
          outDir,
          '--logLevel',
          'silent',
        ],
        { cwd: compilerRoot, encoding: 'utf8' },
      );
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
      const viteConfigUrl = pathToFileURL(join(outDir, 'vite-config.mjs')).href;
      const viteConfigSource = readFileSync(join(outDir, 'vite-config.mjs'), 'utf8');
      expect(viteConfigSource).not.toMatch(/from\s+["']\.\/vite-[^"']+\.mjs["']/u);
      expect(
        readdirSync(outDir).filter(
          (file) => file !== 'vite-config.mjs' && /^vite-[^.]+\.mjs$/u.test(file),
        ),
      ).toEqual([]);

      // Published packages resolve these edges to dist. The workspace probe supplies the equivalent
      // trusted pre-run mapping for dependency packages whose local exports intentionally target TS.
      writeFileSync(
        preloadPath,
        `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
`,
        'utf8',
      );

      writeFileSync(
        installHookPath,
        `
import { registerHooks } from 'node:module';

const forged = 'data:text/javascript,' + encodeURIComponent(
  'export function createFrameworkKovoVitePlugin() {' +
  ' return { transform() { return { code: "export const forgedCompilerAuthority = true;", map: null }; } };' +
  ' }'
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL === ${JSON.stringify(viteConfigUrl)} &&
      specifier.startsWith('./') &&
      specifier.endsWith('.mjs')
    ) return { shortCircuit: true, url: forged };
    return nextResolve(specifier, context);
  },
});
`,
        'utf8',
      );

      writeFileSync(
        probePath,
        `
import { registerHooks } from 'node:module';
import { kovoVitePlugin } from ${JSON.stringify(viteConfigUrl)};

const forged = 'data:text/javascript,' + encodeURIComponent(
  'export function createFrameworkKovoVitePlugin() {' +
  ' return { transform() { return { code: "export const forgedCompilerAuthority = true;", map: null }; } };' +
  ' }'
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL === ${JSON.stringify(viteConfigUrl)} &&
      specifier.startsWith('./') &&
      specifier.endsWith('.mjs')
    ) return { shortCircuit: true, url: forged };
    return nextResolve(specifier, context);
  },
});

const plugin = kovoVitePlugin();
const transformed = await plugin.transform(
  \`import { component } from '@kovojs/core';
export const Reviewed = component({ render: () => <main>Reviewed</main> });\`,
  'src/reviewed.tsx',
);
if (!transformed || transformed.code.includes('forgedCompilerAuthority')) {
  throw new Error('authored resolver substituted compiler authority');
}
if (!transformed.code.includes('Reviewed')) throw new Error('genuine compiler did not lower input');
`,
        'utf8',
      );

      // This is the exact former split-chunk exploit: a hook is active before the published Vite
      // entry is dynamically imported and substitutes any local compiler chunk it tries to load.
      // The dedicated single-entry bundle has no such late-resolved local authority edge.
      writeFileSync(
        prehookProbePath,
        `
import ${JSON.stringify(pathToFileURL(installHookPath).href)};

const { kovoVitePlugin } = await import(${JSON.stringify(viteConfigUrl)});
const plugin = kovoVitePlugin();
const transformed = await plugin.transform(
  \`import { component } from '@kovojs/core';
export const ReviewedPrehook = component({ render: () => <main>Reviewed prehook</main> });\`,
  'src/reviewed-prehook.tsx',
);
if (!transformed || transformed.code.includes('forgedCompilerAuthority')) {
  throw new Error('preinstalled resolver substituted compiler authority');
}
if (!transformed.code.includes('ReviewedPrehook')) {
  throw new Error('genuine compiler did not lower prehook input');
}
`,
        'utf8',
      );

      // ESM links both sibling dependency graphs before evaluating either sibling. A config-owned
      // hook installed by the first sibling must therefore be too late to substitute the compiler
      // authority statically imported by the published Vite entry.
      writeFileSync(
        siblingProbePath,
        `
import ${JSON.stringify(pathToFileURL(installHookPath).href)};
import { kovoVitePlugin } from ${JSON.stringify(viteConfigUrl)};

const plugin = kovoVitePlugin();
const transformed = await plugin.transform(
  \`import { component } from '@kovojs/core';
export const ReviewedSibling = component({ render: () => <main>Reviewed sibling</main> });\`,
  'src/reviewed-sibling.tsx',
);
if (!transformed || transformed.code.includes('forgedCompilerAuthority')) {
  throw new Error('sibling resolver substituted compiler authority');
}
if (!transformed.code.includes('ReviewedSibling')) {
  throw new Error('genuine compiler did not lower sibling-preload input');
}
`,
        'utf8',
      );

      const probe = spawnSync(
        process.execPath,
        ['--experimental-transform-types', '--import', preloadPath, probePath],
        { cwd: root, encoding: 'utf8' },
      );
      expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);

      const prehookProbe = spawnSync(
        process.execPath,
        ['--experimental-transform-types', '--import', preloadPath, prehookProbePath],
        { cwd: root, encoding: 'utf8' },
      );
      expect(prehookProbe.status, `${prehookProbe.stdout}\n${prehookProbe.stderr}`).toBe(0);

      const siblingProbe = spawnSync(
        process.execPath,
        ['--experimental-transform-types', '--import', preloadPath, siblingProbePath],
        { cwd: root, encoding: 'utf8' },
      );
      expect(siblingProbe.status, `${siblingProbe.stdout}\n${siblingProbe.stderr}`).toBe(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);
});
