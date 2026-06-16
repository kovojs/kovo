import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('Kovo Style extraction', () => {
  it('lowers static style.create references to readable classes and atomic CSS', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
}, { namespace: 'button', source: 'button.tsx' });

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source;
    const cssSource = result.files.find((file) => file.kind === 'css')?.source;

    expect(serverSource).toContain(
      'class="kv-button-bg-',
    );
    expect(serverSource).toContain('data-style-src="button.tsx#root"');
    expect(serverSource).not.toContain('style={base.root}');
    expect(cssSource).toContain('@layer kovo-style.3000');
    expect(cssSource).toContain('.kv-button-bg-');
    expect(cssSource).toContain('background-color:black');
    expect(result.cssAssets[0]?.styleRuleUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleFileName: 'components/button.tsx',
          source: 'button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.componentGraphFacts[0]?.styleRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: expect.stringMatching(/^kv-button-bg-/),
          source: 'button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      'export interface ComponentStyleRules',
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      "source: 'button.tsx#root'; styleRef: 'base.root'; moduleFileName: 'components/button.tsx';",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers static style arrays with author-last property wins', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
}, { namespace: 'button', source: 'button.tsx' });

const overrides = style.create({
  danger: {
    backgroundColor: 'red',
  },
}, { namespace: 'buttonOverride', source: 'button.override.tsx' });

export const Button = component({
  render: () => <button style={[base.root, false, overrides.danger]}>Delete</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(serverSource).toContain('class="kv-button-fg-');
    expect(serverSource).toContain('kv-button-override-bg-');
    expect(serverSource).not.toContain('kv-button-bg-');
    expect(serverSource).toContain(
      'data-style-src="button.tsx#root; button.override.tsx#danger"',
    );
  });
});
