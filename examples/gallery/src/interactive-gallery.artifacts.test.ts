import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  extractGeneratedClientRefs,
  galleryRoot,
  generatedInteractiveDemoNames,
  pascalCase,
  readGenerated,
} from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('keeps generated interactive artifacts in sync with app-authored TSX', () => {
    execFileSync(process.execPath, ['scripts/emit-interactive-gallery.mjs', '--check'], {
      cwd: galleryRoot,
      stdio: 'pipe',
    });
  }, 60_000);

  it('wires every compiled interactive demo into the docs gallery route', () => {
    const packageJson = JSON.parse(readFileSync(resolve(galleryRoot, 'package.json'), 'utf8')) as {
      jiso?: { interactiveGallery?: { compiledDemos?: unknown } };
    };
    const manifestDemos = packageJson.jiso?.interactiveGallery?.compiledDemos;
    const generatedDemos = readdirSync(resolve(galleryRoot, 'src/generated/interactive'))
      .filter((fileName) => fileName.endsWith('-demo.tsx'))
      .map((fileName) => fileName.replace(/\.tsx$/, ''))
      .sort(compareStrings);
    const docsDemos = interactiveGalleryDemos.map((demo) => demo.name).sort(compareStrings);

    expect(
      Array.isArray(manifestDemos) ? [...manifestDemos].map(String).sort(compareStrings) : [],
    ).toEqual(generatedDemos);
    expect(docsDemos).toEqual(generatedDemos);

    const html = renderInteractiveGalleryRoute();
    expect(html).toContain('data-gallery-route="/gallery/interactive"');
    expect(html).toContain('data-demo-summary="compiled"');

    for (const demo of generatedDemos) {
      const componentName = demo.replace(/-demo$/, '');
      expect(html).toContain(`href="#${demo}"`);
      expect(html).toContain(`data-gallery-interactive="${componentName}"`);
      expect(html).toContain(`/c/examples/gallery/src/generated/interactive/${demo}.client.js`);
    }
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
      // One module per demo, plus the shared jiso-runtime module and the served headless-ui
      // primitive modules imported by generated handlers (SPEC §4.4: resolvable URLs, no import map).
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
      expect(html).toContain('<title>Jiso Interactive Gallery</title>');
      expect(html).toContain('data-gallery-route="/gallery/interactive"');
      expect(html).toContain('data-gallery-interactive="progress"');
      expect(html).toContain('data-gallery-interactive="meter"');

      for (const href of [
        ...galleryHeadlessUiClientModuleHrefs,
        ...galleryInteractiveClientModuleHrefs,
      ]) {
        expect(html).toContain(`<link rel="modulepreload" href="${href}">`);
        const modulePath = href.replace(/^\//, '').replace(/\?v=[0-9a-f]{8}$/, '');
        expect(existsSync(join(distDir, modulePath)), `${modulePath} was exported`).toBe(true);
      }

      const progressClient = readFileSync(
        join(distDir, 'c/examples/gallery/src/generated/interactive/progress-demo.client.js'),
        'utf8',
      );
      expect(progressClient).toContain('GalleryProgressDemo$button_click');

      const tabsClient = readFileSync(
        join(distDir, 'c/examples/gallery/src/generated/interactive/tabs-demo.client.js'),
        'utf8',
      );
      expect(tabsClient).toContain("from '/c/packages/headless-ui/src/primitives/index.js?v=");
    } finally {
      rmSync(distDir, { force: true, recursive: true });
    }
  }, 60_000);

  it('keeps rendered generated-client DOM refs in lockstep with client exports', () => {
    for (const demo of generatedInteractiveDemoNames()) {
      const componentName = demo.replace(/-demo$/, '');
      const expectedModulePath = `/c/examples/gallery/src/generated/interactive/${demo}.client.js`;
      const clientExports = extractClientExports(readGenerated(`${demo}.client.js`));
      const loweredRefs = extractGeneratedClientRefs(readGenerated(`${demo}.tsx`));
      const renderedDemo = interactiveGalleryDemos.find((entry) => entry.name === demo);
      if (renderedDemo === undefined) throw new Error(`Missing docs route demo: ${demo}`);

      const renderedRefs = extractGeneratedClientRefs(renderedDemo.render());

      expect(clientExports, `${demo} client exports`).not.toEqual([]);
      expect(renderedRefs, `${demo} rendered refs`).toEqual(loweredRefs);
      expect(
        renderedRefs.map((ref) => ref.modulePath),
        `${demo} module paths`,
      ).toEqual(renderedRefs.map(() => expectedModulePath));
      expect(
        renderedRefs.map((ref) => ref.version),
        `${demo} version stamps`,
      ).toEqual(renderedRefs.map(() => expect.stringMatching(/^[0-9a-f]{8}$/)));
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
