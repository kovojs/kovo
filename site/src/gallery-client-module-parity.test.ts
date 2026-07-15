import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { galleryInteractiveClientModuleHrefs } from '../../examples/gallery/src/app-shell.js';

import { compileGalleryInteractiveServerModule } from './gallery.js';

describe('site gallery client module parity', () => {
  it('renders combobox refs for the exact production module registered by the app shell', () => {
    const demoName = 'combobox-demo';
    const source = readFileSync(
      new URL(`../../examples/gallery/src/interactive/${demoName}.tsx`, import.meta.url),
      'utf8',
    );
    const serverSource = compileGalleryInteractiveServerModule(
      `src/interactive/${demoName}.tsx`,
      source,
    );
    const registeredHref = galleryInteractiveClientModuleHrefs.find((href) =>
      href.includes(`/src/interactive/${demoName}.client.js`),
    );

    expect(registeredHref).toBeDefined();
    expect(serverSource).toContain(`${registeredHref}#GalleryComboboxDemo$ComboboxInput_click`);
    expect(serverSource).toContain(`${registeredHref}#GalleryComboboxDemo$ComboboxInput_input`);
    expect(serverSource).toContain(`${registeredHref}#GalleryComboboxDemo$ComboboxInput_keydown`);
  });
});
