import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('browser inline loader response apply', () => {
  it('morphs enhanced mutation fragments through the installed inline loader', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance action="/cart" method="post">',
      '<section kovo-c="cart-form">',
      '<label kovo-key="label">Quantity</label>',
      '<div kovo-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea kovo-key="quantity" name="quantity">12345</textarea>',
      '</section>',
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[kovo-key="panel"]');

    if (!form || !textarea || !panel) throw new Error('missing inline morph fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const fetch = vi.fn(async () => ({
      async text() {
        textarea.focus();
        textarea.setSelectionRange(1, 3, 'forward');
        return [
          '<kovo-fragment target="cart-form">',
          '<section kovo-c="cart-form">',
          '<textarea kovo-key="quantity" name="quantity">67890</textarea>',
          '<div kovo-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
          '<label kovo-key="label">Updated quantity</label>',
          '</section>',
          '</kovo-fragment>',
        ].join('');
      },
    }));
    vi.stubGlobal('fetch', fetch);

    installInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-key="label"]')?.textContent).toBe('Updated quantity'),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector('[kovo-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
  });
});
