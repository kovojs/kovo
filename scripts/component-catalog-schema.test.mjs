import { describe, expect, it } from 'vitest';

import {
  COMPONENT_CATALOG_SCHEMA,
  combineComponentCatalogDocuments,
  validateComponentCatalogDocument,
} from './component-catalog-schema.mjs';

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
});
