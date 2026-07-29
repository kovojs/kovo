import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KOVO_ADD_COMPONENT_NAMES } from '../packages/cli/src/add-component-names.ts';

import {
  COMPONENT_CATALOG_SCHEMA,
  combineComponentCatalogDocuments,
  validateComponentCatalogDocument,
} from './component-catalog-schema.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function entry(overrides = {}) {
  return {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: [],
    },
    copyCommand: 'kovo add button',
    enhancement: {
      accessibility: 'The native button preserves its accessible-name contract.',
      keyboard: 'The native button keeps platform keyboard activation behavior.',
      roles: ['button'],
      tier: 'native',
    },
    id: 'component:button',
    kind: 'component',
    name: 'button',
    packageImport: '@kovojs/ui/button',
    searchText: 'button Button @kovojs/ui/button',
    summary: 'A native button.',
    title: 'Button',
    ...overrides,
  };
}

describe('component catalog schema', () => {
  it('validates package-owned component and icon documents', () => {
    const component = {
      schema: COMPONENT_CATALOG_SCHEMA,
      owner: '@kovojs/ui',
      entries: [entry()],
    };
    const icon = {
      schema: COMPONENT_CATALOG_SCHEMA,
      owner: '@kovojs/icons',
      entries: [
        entry({
          anatomy: null,
          copyCommand: null,
          id: 'icon:arrow-right',
          kind: 'icon',
          name: 'arrow-right',
          packageImport: '@kovojs/icons/arrow-right',
          title: 'Arrow Right',
        }),
      ],
    };

    expect(validateComponentCatalogDocument(component)).toEqual([]);
    expect(validateComponentCatalogDocument(icon)).toEqual([]);
    expect(combineComponentCatalogDocuments([icon, component]).entries.map(({ id }) => id)).toEqual(
      ['component:button', 'icon:arrow-right'],
    );
  });

  it('rejects ownership, import, anatomy, enhancement, and ordering drift', () => {
    expect(
      validateComponentCatalogDocument({
        schema: COMPONENT_CATALOG_SCHEMA,
        owner: 'ui',
        entries: [
          entry({ id: 'component:z' }),
          entry({
            anatomy: { ids: [], parts: [], slots: ['root'], stateInputs: [] },
            enhancement: {
              accessibility: 'short',
              keyboard: '',
              roles: ['button', 'button'],
              tier: 'magic',
            },
            id: 'component:a',
            packageImport: '@kovojs/ui',
          }),
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'catalog owner must name an @kovojs package',
        'catalog entries must be id-sorted',
        'entries[1].packageImport must use the component subpath',
        'entries[1].anatomy.parts must not be empty',
        'entries[1].enhancement.tier is invalid',
        'entries[1].enhancement.roles must be unique',
      ]),
    );
  });

  it('binds the combined 44 + 1737 catalog to package exports and kovo add', () => {
    const manifest = readJson('public-packages.json');
    const ui = readJson('packages/ui/catalog.json');
    const icons = readJson('packages/icons/catalog.json');
    const combined = readJson('catalog/component-icon-catalog.json');
    const uiPackage = manifest.packages.find((pkg) => pkg.name === '@kovojs/ui');
    const iconPackage = manifest.packages.find((pkg) => pkg.name === '@kovojs/icons');

    const componentNames = ui.entries.map((entry) => entry.name);
    const iconNames = icons.entries.map((entry) => entry.name);
    expect(componentNames).toEqual([...KOVO_ADD_COMPONENT_NAMES]);
    expect([...uiPackage.apiBoundary.public].sort()).toEqual(
      componentNames.map((name) => `./${name}`).sort(),
    );
    expect([...iconPackage.apiBoundary.public].sort()).toEqual(
      ['.', ...iconNames.map((name) => `./${name}`)].sort(),
    );
    expect(ui.entries.map((entry) => entry.copyCommand)).toEqual(
      componentNames.map((name) => `kovo add ${name}`),
    );
    expect(combined).toEqual(combineComponentCatalogDocuments([ui, icons]));
    expect(combined.entries.filter((entry) => entry.kind === 'component')).toHaveLength(44);
    expect(combined.entries.filter((entry) => entry.kind === 'icon')).toHaveLength(1_737);
  });
});
