import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  galleryHeadlessUiClientModuleHrefs,
  galleryInteractiveClientModuleHrefs,
} from './app-shell.js';
import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';
import {
  compareStrings,
  extractClientExports,
  extractCompiledClientRefs,
  galleryRoot,
  interactiveDemoNames,
  pascalCase,
  readCompiledArtifact,
  readCompiledDemo,
} from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('compiles app-authored interactive demos into emitted artifacts on demand', () => {
    for (const demo of interactiveDemoNames()) {
      const compiled = readCompiledDemo(`${demo}.tsx`);
      expect(compiled, demo).toContain(`data-gallery-interactive="${demo.replace(/-demo$/, '')}"`);
      expect(compiled, demo).toContain(`Gallery${pascalCase(demo.replace(/-demo$/, ''))}Demo`);
    }
  });

  it('wires every compiled interactive demo into the docs gallery route', async () => {
    const packageJson = JSON.parse(readFileSync(resolve(galleryRoot, 'package.json'), 'utf8')) as {
      kovo?: { interactiveGallery?: { compiledDemos?: unknown } };
    };
    const manifestDemos = packageJson.kovo?.interactiveGallery?.compiledDemos;
    const compiledDemos = interactiveDemoNames();
    const docsDemos = interactiveGalleryDemos.map((demo) => demo.name).sort(compareStrings);
    const clientModuleDemos = galleryInteractiveClientModuleHrefs
      .map(
        (href) =>
          href.match(/\/(?:src\/)?(?:generated\/)?interactive\/([^/]+)\.client\.js$/)?.[1] ?? '',
      )
      .sort(compareStrings);

    expect(
      Array.isArray(manifestDemos) ? [...manifestDemos].map(String).sort(compareStrings) : [],
    ).toEqual(compiledDemos);
    expect(docsDemos).toEqual(compiledDemos);
    expect(clientModuleDemos).toEqual(compiledDemos);

    const html = await renderInteractiveGalleryRoute();
    expect(html).toContain('data-gallery-route="/gallery/interactive"');
    expect(html).toContain('data-demo-summary="compiled"');
    expect(html).not.toContain('[object Promise]');

    for (const demo of compiledDemos) {
      const componentName = demo.replace(/-demo$/, '');
      expect(html).toContain(`href="#${demo}"`);
      expect(html).toContain(`data-gallery-interactive="${componentName}"`);
    }
  });

  it('resolves nested styled UI descriptors in the interactive route render path', async () => {
    const html = await renderInteractiveGalleryRoute();

    expect(html).toContain('data-gallery-interactive="pure-markup"');
    expect(html).toContain('data-style-src="card.tsx#root"');
    expect(html).toContain('data-style-src="badge.tsx#root; badge.tsx#success"');
    expect(html).toContain('data-style-src="breadcrumb.tsx#root"');
    expect(html).toContain('data-style-src="kbd.tsx#root"');
    expect(html).toContain('data-style-src="table.tsx#wrapper"');
    expect(html).not.toContain('[object Promise]');
  });

  it('exports the compiled interactive docs route and client modules for static deployment', () => {
    const distDir = resolve(galleryRoot, 'dist');
    rmSync(distDir, { force: true, recursive: true });

    try {
      const output = execFileSync('pnpm', ['exec', 'vp', 'run', '--no-cache', 'export'], {
        cwd: galleryRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      expect(output).toContain('gallery-interactive-export/v1');
      expect(output).toContain('html=1');
      // One module per demo, plus the shared kovo-runtime module and the served headless-ui
      // primitive modules imported by compiled handlers (SPEC §4.4: resolvable URLs, no import map).
      expect(output).toContain(
        `client-modules=${
          interactiveGalleryDemos.length + galleryHeadlessUiClientModuleHrefs.length + 1
        }`,
      );
      expect(output).toContain(
        `assets=${existsSync(resolve(galleryRoot, '../../site/dist-css/assets/site.css')) ? 1 : 0}`,
      );
      expect(output).toContain('diagnostics=0');

      const html = readFileSync(join(distDir, 'gallery/interactive/index.html'), 'utf8');
      expect(html).toContain('<title>Kovo Interactive Gallery</title>');
      expect(html).toContain('data-gallery-route="/gallery/interactive"');
      expect(html).toContain('data-gallery-interactive="progress"');
      expect(html).toContain('data-gallery-interactive="meter"');

      for (const href of [
        ...galleryHeadlessUiClientModuleHrefs,
        ...galleryInteractiveClientModuleHrefs,
      ]) {
        expect(html).toContain(`<link rel="modulepreload" href="${href}">`);
        const modulePath = href.replace(/^\//, '');
        expect(existsSync(join(distDir, modulePath)), `${modulePath} was exported`).toBe(true);
      }

      const progressClient = readFileSync(
        join(
          distDir,
          exportedModulePath(
            galleryInteractiveClientModuleHrefs.find((href) =>
              href.endsWith('/interactive/progress-demo.client.js'),
            ) ?? '',
          ),
        ),
        'utf8',
      );
      expect(progressClient).toContain('GalleryProgressDemo$Button_click');

      const tabsClient = readFileSync(
        join(
          distDir,
          exportedModulePath(
            galleryInteractiveClientModuleHrefs.find((href) =>
              href.endsWith('/interactive/tabs-demo.client.js'),
            ) ?? '',
          ),
        ),
        'utf8',
      );
      expect(tabsClient).toContain("from '/c/__v/");
      expect(tabsClient).toContain("/packages/headless-ui/src/primitives/tabs.js'");
    } finally {
      rmSync(distDir, { force: true, recursive: true });
    }
  }, 180_000);

  it('keeps compiled-client DOM refs in lockstep with client exports', () => {
    for (const demo of interactiveDemoNames()) {
      const componentName = demo.replace(/-demo$/, '');
      const expectedModulePath = `/c/src/interactive/${demo}.client.js`;
      const clientExports = extractClientExports(readCompiledArtifact(`${demo}.client.js`));
      const renderedRefs = extractCompiledClientRefs(readCompiledArtifact(`${demo}.tsx`));

      expect(clientExports, `${demo} client exports`).not.toEqual([]);
      expect(renderedRefs, `${demo} rendered refs`).not.toEqual([]);
      expect(
        renderedRefs.map((ref) => ref.modulePath),
        `${demo} module paths`,
      ).toEqual(renderedRefs.map(() => expectedModulePath));
      expect(
        renderedRefs.map((ref) => ref.version),
        `${demo} version stamps`,
      ).toEqual(renderedRefs.map(() => expect.stringMatching(/^[0-9a-f][0-9a-f-]*$/)));
      expect(renderedRefs.map((ref) => ref.exportName).sort(compareStrings)).toEqual(clientExports);

      for (const ref of renderedRefs) {
        expect(ref.exportName, `${demo} ${ref.eventName} ref`).toMatch(
          new RegExp(
            `^Gallery${pascalCase(componentName)}Demo\\$[A-Za-z0-9]+_${ref.eventName}(?:_\\d+)?$`,
          ),
        );
      }
    }
  });
});

function exportedModulePath(href: string): string {
  if (!href) throw new Error('Missing gallery exported module href.');
  return href.replace(/^\//, '');
}
