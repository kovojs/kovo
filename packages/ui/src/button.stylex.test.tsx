import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Button, buttonClasses, buttonStyles } from './button.js';

describe('@kovojs/ui Button StyleX prototype', () => {
  it('renders StyleX-authored classes and metadata', () => {
    const html = Button.definition.render({
      children: 'Save',
      disabled: true,
      form: 'settings-form',
      name: 'settings-action',
      size: 'sm',
      type: 'submit',
      value: 'save',
      variant: 'secondary',
    }) as string;

    expect(html).toContain('<button class="kv-button-');
    expect(html).toContain('kv-button-size-');
    expect(html).toContain('kv-button-variant-');
    expect(html).toContain('data-style-src="button.tsx#root; button.tsx#sm; button.tsx#secondary"');
    expect(html).toContain('disabled form="settings-form" name="settings-action"');
    expect(html).toContain('type="submit" value="save"');
    expect(html).not.toContain('inline-flex items-center justify-center');
  });

  it('accepts author-last typed style overrides', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: 'tomato',
          color: 'black',
          ':hover': {
            backgroundColor: 'tomato',
          },
        },
      },
      { namespace: 'appButton', source: 'app-button.tsx' },
    );
    const html = Button.definition.render({
      children: 'Save',
      style: overrides.root,
    }) as string;

    expect(html).toContain('kv-app-button-bg-');
    expect(html).toContain('kv-app-button-fg-');
    expect(html).not.toContain('kv-button-variant-bg-');
    expect(html).toContain('app-button.tsx#root');
  });

  it('exports StyleX style objects instead of variant-helper output', () => {
    expect(buttonStyles.base.root.$$css).toBe(true);
    expect(buttonClasses.join(' ')).toContain('kv-button-size-h-');
    expect(buttonClasses.join(' ')).toContain('kv-button-variant-bg-');
  });
});
