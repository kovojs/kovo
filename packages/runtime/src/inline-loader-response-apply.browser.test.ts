import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineJisoLoader } from './inline-loader.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('browser inline loader response apply', () => {
  it('morphs enhanced mutation fragments through the installed inline loader', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance action="/cart" method="post">',
      '<section fw-c="cart-form">',
      '<label fw-key="label">Quantity</label>',
      '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea fw-key="quantity" name="quantity">12345</textarea>',
      '</section>',
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[fw-key="panel"]');

    if (!form || !textarea || !panel) throw new Error('missing inline morph fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const fetch = vi.fn(async () => ({
      async text() {
        textarea.focus();
        textarea.setSelectionRange(1, 3, 'forward');
        return [
          '<fw-fragment target="cart-form">',
          '<section fw-c="cart-form">',
          '<textarea fw-key="quantity" name="quantity">67890</textarea>',
          '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
          '<label fw-key="label">Updated quantity</label>',
          '</section>',
          '</fw-fragment>',
        ].join('');
      },
    }));
    vi.stubGlobal('fetch', fetch);

    installInlineJisoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[fw-key="label"]')?.textContent).toBe('Updated quantity'),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector('[fw-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
  });
});
