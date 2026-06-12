import { installJisoLoader, type JisoLoader } from '@jiso/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as checkboxClient from './generated/interactive/checkbox-demo.client.js';
import { GalleryCheckboxDemo } from './generated/interactive/checkbox-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as collapsibleClient from './generated/interactive/collapsible-demo.client.js';
import { GalleryCollapsibleDemo } from './generated/interactive/collapsible-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as disclosureClient from './generated/interactive/disclosure-demo.client.js';
import { GalleryDisclosureDemo } from './generated/interactive/disclosure-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as dialogClient from './generated/interactive/dialog-demo.client.js';
import { GalleryDialogDemo } from './generated/interactive/dialog-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as numberFieldClient from './generated/interactive/number-field-demo.client.js';
import { GalleryNumberFieldDemo } from './generated/interactive/number-field-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as popoverClient from './generated/interactive/popover-demo.client.js';
import { GalleryPopoverDemo } from './generated/interactive/popover-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as switchClient from './generated/interactive/switch-demo.client.js';
import { GallerySwitchDemo } from './generated/interactive/switch-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as tabsClient from './generated/interactive/tabs-demo.client.js';
import { GalleryTabsDemo } from './generated/interactive/tabs-demo.js';
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
  '/c/examples/gallery/src/generated/interactive/collapsible-demo.client.js': collapsibleClient,
  '/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js': disclosureClient,
  '/c/examples/gallery/src/generated/interactive/dialog-demo.client.js': dialogClient,
  '/c/examples/gallery/src/generated/interactive/number-field-demo.client.js': numberFieldClient,
  '/c/examples/gallery/src/generated/interactive/popover-demo.client.js': popoverClient,
  '/c/examples/gallery/src/generated/interactive/switch-demo.client.js': switchClient,
  '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js': tabsClient,
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

  it('updates number-field stamped state through generated steppers', async () => {
    const root = mountInteractiveDemo(GalleryNumberFieldDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const increment = required(root.querySelector<HTMLButtonElement>('[data-action="increment"]'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="value"]'));
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"value":2}');
    expect(input.type).toBe('number');
    expect(input.name).toBe('gallery-seat-count');
    expect(input.required).toBe(true);
    expect(input.value).toBe('2');
    expect(output.textContent).toBe('2');

    increment.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/number-field-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":3}');
    });

    required(root.querySelector<HTMLButtonElement>('[data-action="decrement"]')).click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"value":2}');
    });
  });

  it('opens and closes a native dialog through generated handlers and invoker attributes', async () => {
    const root = mountInteractiveDemo(GalleryDialogDemo);
    const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
    const dialog = required(root.querySelector<HTMLDialogElement>('#gallery-dialog-content'));
    const close = required(
      dialog.querySelector<HTMLButtonElement>('button[command="request-close"]'),
    );
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="open"]'));
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-dialog-content');
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute('aria-labelledby')).toBe('gallery-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('gallery-dialog-description');
    expect(output.textContent).toBe('closed');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/dialog-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    close.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
    });
  });

  it('updates switch stamped state while native checked state moves in the browser', async () => {
    const root = mountInteractiveDemo(GallerySwitchDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"checked":false}');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);

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

  it('updates collapsible stamped state while native details open state moves', async () => {
    const root = mountInteractiveDemo(GalleryCollapsibleDemo) as HTMLDetailsElement;
    const summary = required(root.querySelector<HTMLElement>('summary'));
    const content = required(root.querySelector<HTMLElement>('#gallery-collapsible-content'));
    installGeneratedGalleryLoader(root);

    expect(root.open).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(content.id).toBe('gallery-collapsible-content');

    summary.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(root.open).toBe(true);
    });

    summary.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(root.open).toBe(false);
    });
  });

  it('updates popover stamped state while native top-layer state moves', async () => {
    const root = mountInteractiveDemo(GalleryPopoverDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const content = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
    installGeneratedGalleryLoader(root);

    expect(button.getAttribute('popovertarget')).toBe('gallery-popover-content');
    expect(content.matches(':popover-open')).toBe(false);

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(content.matches(':popover-open')).toBe(true);
    });

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(content.matches(':popover-open')).toBe(false);
    });
  });

  it('updates tabs stamped state from generated click handlers', async () => {
    const root = mountInteractiveDemo(GalleryTabsDemo);
    const overview = required(
      root.querySelector<HTMLButtonElement>('#gallery-tabs-overview-trigger'),
    );
    const details = required(
      root.querySelector<HTMLButtonElement>('#gallery-tabs-details-trigger'),
    );
    const overviewPanel = required(root.querySelector<HTMLElement>('#gallery-tabs-overview-panel'));
    const detailsPanel = required(root.querySelector<HTMLElement>('#gallery-tabs-details-panel'));
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"value":"overview"}');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(overview.tabIndex).toBe(0);
    expect(details.getAttribute('aria-selected')).toBe('false');
    expect(details.tabIndex).toBe(-1);
    expect(overviewPanel.hidden).toBe(false);
    expect(detailsPanel.hidden).toBe(true);

    details.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":"details"}');
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
