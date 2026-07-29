import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';
import * as style from '@kovojs/style';
import { Button } from './button.js';
describe('@kovojs/ui Button StyleX prototype', () => {
  it('renders StyleX-authored classes and metadata', () => {
    const html = String(
      renderUiComponent(Button, {
        children: 'Save',
        disabled: true,
        form: 'settings-form',
        name: 'settings-action',
        size: 'sm',
        type: 'submit',
        value: 'save',
        variant: 'secondary',
      }),
    );
    expect(html).toContain('<button class="kv-button-');
    expect(html).toContain('kv-button-size-');
    expect(html).toContain('kv-button-variant-');
    expect(html).toContain('data-style-src="button.tsx#root; button.tsx#sm; button.tsx#secondary"');
    expect(html).toContain('disabled form="settings-form" name="settings-action"');
    expect(html).toContain('type="submit" value="save"');
    expect(html).not.toContain('inline-flex items-center justify-center');
  });
  it('accepts author-last typed style overrides', () => {
    const overrides = style.create({
      root: {
        backgroundColor: 'tomato',
        color: 'black',
        ':hover': {
          backgroundColor: 'tomato',
        },
      },
    });
    const html = String(
      renderUiComponent(Button, {
        children: 'Save',
        style: overrides.root,
      }),
    );
    expect(html).toContain('kv-button-stylex-test-bg-');
    expect(html).toContain('kv-button-stylex-test-fg-');
    expect(html).not.toContain('kv-button-variant-bg-');
    expect(html).toContain('button.stylex.test.tsx#root');
  });
  it('renders size and variant StyleX classes without exposing style objects', () => {
    const html = [
      renderUiComponent(Button, { children: 'Primary' }),
      renderUiComponent(Button, { children: 'Small', size: 'sm' }),
      renderUiComponent(Button, { children: 'Secondary', variant: 'secondary' }),
      renderUiComponent(Button, { children: 'Ghost', variant: 'ghost' }),
      renderUiComponent(Button, { children: 'Destructive', variant: 'destructive' }),
      renderUiComponent(Button, { children: 'Outline', variant: 'outline' }),
    ].join(' ');

    expect(html).toContain('kv-button-size-h-');
    expect(html).toContain('kv-button-variant-bg-');
    expect(html).toContain('data-style-src="button.tsx#root; button.tsx#md; button.tsx#primary"');
    expect(html).toContain('data-style-src="button.tsx#root; button.tsx#sm; button.tsx#primary"');
    expect(html).toContain('button.tsx#secondary');
  });
});
