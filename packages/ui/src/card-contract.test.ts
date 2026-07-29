import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { renderHtmlValue } from '@kovojs/server/internal/html';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card.js';
import { renderUiComponent } from './test-component-render.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(srcDir);
const anatomy = ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'];

describe('@kovojs/ui/card public anatomy', () => {
  it('renders the root, header, title, description, content, and footer parts', () => {
    const children =
      renderUiComponent(CardHeader, {
        children:
          renderUiComponent(CardTitle, { children: 'Account' }) +
          renderUiComponent(CardDescription, { children: 'Profile settings' }),
      }) +
      renderUiComponent(CardContent, { children: 'Controls' }) +
      renderUiComponent(CardFooter, { children: 'Saved' });
    const html = renderHtmlValue(renderUiComponent(Card, { children }));

    expect(html).toMatch(/^<section /);
    expect(html).toContain('<h3 ');
    expect(html).toContain('>Account</h3>');
    expect(html).toContain('>Profile settings</p>');
    expect(html).toContain('>Controls</div>');
    expect(html).toContain('>Saved</footer>');
  });

  it('keeps source, registry, catalog, and README on the same six exports', () => {
    const registry = JSON.parse(readFileSync(join(packageRoot, 'registry.json'), 'utf8')) as {
      components: { anatomy: { parts: string[] }; exports: string[]; name: string }[];
    };
    const catalog = JSON.parse(readFileSync(join(packageRoot, 'catalog.json'), 'utf8')) as {
      entries: { anatomy: { parts: string[] }; name: string }[];
    };
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
    const registryCard = registry.components.find((entry) => entry.name === 'card');
    const catalogCard = catalog.entries.find((entry) => entry.name === 'card');

    expect(registryCard?.exports).toEqual(anatomy);
    expect(registryCard?.anatomy.parts).toEqual([
      'root',
      'header',
      'title',
      'description',
      'content',
      'footer',
    ]);
    expect(catalogCard?.anatomy.parts).toEqual(registryCard?.anatomy.parts);
    for (const symbol of anatomy) expect(readme).toContain(symbol);
    expect(readme).not.toContain('CardBody');
  });
});
