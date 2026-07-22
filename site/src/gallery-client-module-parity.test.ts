import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { galleryInteractiveClientModuleBindings } from '../../examples/gallery/src/app-shell.js';
import { rewriteGalleryClientModuleHrefs } from '../../examples/gallery/src/client-module-manifest.js';

import {
  compileGalleryInteractiveClientModule,
  compileGalleryInteractiveServerModule,
} from './gallery.js';

describe('site gallery client module parity', () => {
  it('rebases combobox refs to the exact final representation registered by the app shell', () => {
    const demoName = 'combobox-demo';
    const source = readFileSync(
      new URL(`../../examples/gallery/src/interactive/${demoName}.tsx`, import.meta.url),
      'utf8',
    );
    const serverSource = compileGalleryInteractiveServerModule(
      `src/interactive/${demoName}.tsx`,
      source,
    );
    const binding = galleryInteractiveClientModuleBindings.find(
      ({ demoName: candidate }) => candidate === demoName,
    );
    expect(binding).toBeDefined();
    if (binding === undefined) throw new Error(`Missing ${demoName} client binding.`);
    const rebasedServerSource = rewriteGalleryClientModuleHrefs(serverSource, [binding]);

    expect(binding.compiledHref).not.toBe(binding.href);
    expect(rebasedServerSource).not.toContain(binding.compiledHref);
    expect(rebasedServerSource).toContain(
      `${binding.href}#GalleryComboboxDemo$ComboboxInput_click`,
    );
    expect(rebasedServerSource).toContain(
      `${binding.href}#GalleryComboboxDemo$ComboboxInput_input`,
    );
    expect(rebasedServerSource).toContain(
      `${binding.href}#GalleryComboboxDemo$ComboboxInput_keydown`,
    );
  });

  it('keeps the handler export referenced by a reviewed UI component boundary', () => {
    const compiled = compileGalleryInteractiveClientModule(
      'toggle-demo',
      'src/interactive/toggle-demo.tsx',
    );

    expect(compiled.source).toContain(
      'export const GalleryToggleDemo$Toggle_click = securityHandler([{"door":"reviewed-client-export","kind":"browser.framework.call","target":"_toggleTriggerClick"},{"door":"compiler-state","kind":"browser.state.write","target":"state.pressed"}], (event, ctx) =>',
    );
    expect(compiled.manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moduleSpecifier: '@kovojs/headless-ui/generated' }),
      ]),
    );
  });
});
