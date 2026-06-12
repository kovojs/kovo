import { installJisoLoader, type JisoLoader } from '@jiso/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as checkboxClient from './generated/interactive/checkbox-demo.client.js';
import { GalleryCheckboxDemo } from './generated/interactive/checkbox-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as disclosureClient from './generated/interactive/disclosure-demo.client.js';
import { GalleryDisclosureDemo } from './generated/interactive/disclosure-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as toggleClient from './generated/interactive/toggle-demo.client.js';
import { GalleryToggleDemo } from './generated/interactive/toggle-demo.js';

interface InteractiveDemoComponent {
  definition: {
    render: (queries: Record<string, never>, state: never) => string;
    state: () => unknown;
  };
}

const generatedModules: Record<string, Record<string, unknown>> = {
  '/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js': checkboxClient,
  '/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js': disclosureClient,
  '/c/examples/gallery/src/generated/interactive/toggle-demo.client.js': toggleClient,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('updates toggle stamped state from generated click and keyboard handlers', async () => {
    const root = mountInteractiveDemo(GalleryToggleDemo);
    const { imports } = installGeneratedGalleryLoader(root);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="pressed"]'));

    expect(imports).toEqual([]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-state')).toBe('off');
    expect(output.textContent).toBe('off');

    button.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/toggle-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"pressed":true}');
    });

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"pressed":false}');
    });
  });

  it('updates checkbox stamped and native checked state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryCheckboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="checked"]'));
    installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"checked":"indeterminate"}');
    expect(input.getAttribute('aria-checked')).toBe('mixed');
    expect(output.textContent).toBe('indeterminate');

    input.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
    });

    input.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":false}');
      expect(input.checked).toBe(false);
    });
  });

  it('updates disclosure stamped state from generated click and keyboard handlers', async () => {
    const root = mountInteractiveDemo(GalleryDisclosureDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const panel = required(
      root.querySelector<HTMLElement>('#gallery-interactive-disclosure-panel'),
    );
    installGeneratedGalleryLoader(root);

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('gallery-interactive-disclosure-panel');
    expect(panel.hidden).toBe(true);

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
    });

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    });
  });
});

function mountInteractiveDemo(component: InteractiveDemoComponent): HTMLElement {
  const host = document.createElement('main');
  host.innerHTML = component.definition.render({}, component.definition.state() as never);
  document.body.append(host);

  return required(host.firstElementChild as HTMLElement | null);
}

function installGeneratedGalleryLoader(root: HTMLElement): {
  imports: string[];
  loader: JisoLoader;
} {
  const imports: string[] = [];
  const loader = installJisoLoader({
    async importModule(url) {
      const modulePath = url.split('?')[0] ?? url;
      imports.push(modulePath);

      const mod = generatedModules[modulePath];
      if (!mod) throw new Error(`Missing generated interactive module: ${url}`);

      return mod;
    },
    root,
  });

  return { imports, loader };
}

function required<ElementType extends Element>(element: ElementType | null): ElementType {
  if (!element) throw new Error('Missing interactive gallery browser fixture element');

  return element;
}
