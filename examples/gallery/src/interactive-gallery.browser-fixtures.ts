import axe from 'axe-core';
import { installKovoLoader, type KovoLoader } from '@kovojs/browser/client';
import { applyCheckboxIndeterminate } from '@kovojs/headless-ui/checkbox';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  interactiveClientModuleNames,
  staticVisualFixtureHtml,
  type StaticVisualFixturePath,
} from './interactive-gallery.browser-manifest.js';

export {
  staticVisualFixtureHtml,
  type StaticVisualFixturePath,
} from './interactive-gallery.browser-manifest.js';

export interface InteractiveDemoComponent {
  definition: {
    render: (queries: Record<string, never>, state: never) => Promise<string> | string;
    state: () => unknown;
  };
}

type InteractiveClientModule = Record<string, unknown>;

declare global {
  interface ImportMeta {
    glob<TModule>(pattern: string, options: { eager: true }): Record<string, TModule>;
  }
}

const generatedInteractiveClientModules = import.meta.glob<InteractiveClientModule>(
  './generated/interactive/*-demo.client.js',
  { eager: true },
);

export const interactiveClientModules: Record<string, InteractiveClientModule> = Object.fromEntries(
  interactiveClientModuleNames.map((name) => [
    `/c/src/interactive/${name}.client.js`,
    requiredInteractiveClientModule(name),
  ]),
);

export async function mountInteractiveDemo(
  component: InteractiveDemoComponent,
): Promise<HTMLElement> {
  const host = document.createElement('main');
  host.innerHTML = await component.definition.render({}, component.definition.state() as never);
  document.body.append(host);

  return required(host.firstElementChild as HTMLElement | null);
}

export function mountStaticGalleryRoute(path: StaticVisualFixturePath): HTMLElement {
  const html = staticVisualFixtureHtml[path];
  const host = document.createElement('main');
  host.innerHTML = html;
  document.body.append(host);

  return required(host.querySelector<HTMLElement>(`[data-gallery-route="${path}"]`));
}

export function installInteractiveGalleryLoader(
  root: HTMLElement,
  options: { events?: readonly string[] } = {},
): {
  imports: string[];
  loader: KovoLoader;
} {
  const imports: string[] = [];
  const loader = installKovoLoader({
    // SPEC §4.7/§4.8: the synthetic browser harness has no document-level route hints, so
    // snapshot the exact compiler-emitted element manifest before asynchronous state derives run.
    // This also keeps pending derives authorized if test cleanup removes the mounted root.
    allowedClientModuleUrls: declaredClientModuleUrls(root),
    async importModule(url) {
      const modulePath = normalizeInteractiveClientModulePath(url);
      if (!imports.includes(modulePath)) imports.push(modulePath);

      const mod = interactiveClientModules[modulePath];
      if (!mod) throw new Error(`Missing interactive gallery client module: ${url}`);

      return mod;
    },
    onError(error) {
      throw error;
    },
    ...(options.events ? { events: options.events } : {}),
    root,
  });

  return { imports, loader };
}

function declaredClientModuleUrls(root: HTMLElement): string[] {
  const elements = [
    ...(root.matches('[data-kovo-module-allowlist]') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('[data-kovo-module-allowlist]'),
  ];
  const urls = new Set<string>();
  for (const element of elements) {
    for (const url of (element.getAttribute('data-kovo-module-allowlist') ?? '')
      .split(/\s+/)
      .filter(Boolean)) {
      urls.add(url);
    }
  }
  return [...urls];
}

function normalizeInteractiveClientModulePath(url: string): string {
  const modulePath = url.split('?')[0] ?? url;
  const versioned = /^\/c\/__v\/[^/]+\/(.+)$/.exec(modulePath);

  return versioned ? `/c/${versioned[1]}` : modulePath;
}

function requiredInteractiveClientModule(name: string): InteractiveClientModule {
  const modulePath = `./generated/interactive/${name}.client.js`;
  const mod = generatedInteractiveClientModules[modulePath];
  if (mod === undefined)
    throw new Error(`Missing interactive gallery client module: ${modulePath}`);

  return mod;
}

export function required<ElementType extends Element>(element: ElementType | null): ElementType {
  if (!element) throw new Error('Missing interactive gallery browser fixture element');

  return element;
}

export async function expectInteractiveSideDialog(options: {
  clientModulePath: string;
  component: InteractiveDemoComponent;
  contentId: string;
  demoStateName: string;
  side: string;
}): Promise<void> {
  const root = await mountInteractiveDemo(options.component);
  const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
  const dialog = required(root.querySelector<HTMLDialogElement>(`#${options.contentId}`));
  const close = required(
    dialog.querySelector<HTMLButtonElement>('button[command="request-close"]'),
  );
  const output = required(
    root.querySelector<HTMLOutputElement>(`[data-demo-state="${options.demoStateName}"]`),
  );
  const { imports } = installInteractiveGalleryLoader(root);

  expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
  expect(root.getAttribute('data-side')).toBe(options.side);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.getAttribute('aria-controls')).toBe(options.contentId);
  expect(trigger.getAttribute('commandfor')).toBe(options.contentId);
  expect(dialog.getAttribute('data-side')).toBe(options.side);
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.getAttribute('closedby')).toBe('any');
  expect(dialog.open).toBe(false);
  expect(output.textContent).toBe('closed');

  trigger.click();

  await vi.waitFor(() => {
    expect(imports).toEqual([options.clientModulePath]);
    expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
    expect(dialog.open).toBe(true);
  });

  await vi.waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  await userEvent.tab();
  expect(document.activeElement).not.toBe(trigger);

  // SPEC §12.1: the open sheet/drawer side-dialog top-layer state (dialog.open,
  // role=dialog, aria-modal, side anchored, focus starts inside and the
  // background trigger is not reachable by Tab) must stay axe-clean.
  // Covers both sheet and drawer via this shared helper, asserted while open
  // before close. axe.run(root) descends into the promoted <dialog> (DOM child of root).
  await expectNoAxeViolations(root);

  close.click();

  await vi.waitFor(() => {
    expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
}

export async function visualBaselineHash(element: HTMLElement): Promise<string> {
  const screenshot = await page.screenshot({
    element,
    save: false,
  });

  return fnv1a(screenshot);
}

export function visualGeometry(element: HTMLElement): { height: number; width: number } {
  const rect = element.getBoundingClientRect();

  return {
    height: Math.round(rect.height),
    width: Math.round(rect.width),
  };
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function installVisualBaselineStyles(): void {
  const style = document.createElement('style');
  style.dataset.galleryVisualBaseline = 'true';
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      caret-color: transparent !important;
      transition-duration: 0s !important;
      animation-duration: 0s !important;
    }

    body {
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    [data-gallery-route="/gallery/interactive"] {
      width: 820px;
      margin: 0;
      padding: 24px 20px 32px;
      background: #ffffff;
    }

    [data-gallery-route^="/components/"] {
      width: 860px;
      margin: 0 0 18px;
      padding: 24px 22px 30px;
      background: #ffffff;
    }

    [data-gallery-route] > h1 {
      margin: 0 0 6px;
      font-size: 24px;
      line-height: 1.2;
    }

    [data-demo-summary] {
      margin: 0 0 18px;
      max-width: 680px;
      color: #475569;
    }

    nav[aria-label] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 18px;
    }

    nav[aria-label] a {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 8px;
      color: #1d4ed8;
      text-decoration: none;
    }

    [data-gallery-interactive-route] {
      width: 780px;
      margin: 0 0 12px;
      padding: 14px;
      border: 1px solid #dbe3ec;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
    }

    [data-gallery-interactive-route] h2,
    [data-gallery-demo] h2,
    [data-gallery-demo] h3,
    [data-gallery-interactive] h3,
    [data-gallery-interactive] p {
      margin-top: 0;
    }

    [data-gallery-demo] {
      display: grid;
      gap: 10px;
      width: 816px;
      margin: 0;
      padding: 14px;
      border: 1px solid #dbe3ec;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
    }

    [data-gallery-contract] {
      margin: 0;
      color: #475569;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      border-bottom: 1px solid #e2e8f0;
      padding: 6px 8px;
      text-align: left;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button,
    [role="button"],
    [role="menuitem"],
    [role="option"],
    [role="tab"] {
      border: 1px solid #94a3b8;
      border-radius: 6px;
      background: #f8fafc;
      color: #0f172a;
      padding: 5px 9px;
    }

    [aria-selected="true"],
    [aria-checked="true"],
    [aria-pressed="true"],
    [data-state="open"] {
      border-color: #2563eb;
      background: #dbeafe;
    }

    [role="menu"],
    [role="listbox"],
    [role="tablist"],
    [role="toolbar"],
    [role="radiogroup"],
    [role="group"] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-block: 8px;
    }

    [role="progressbar"],
    [role="meter"] {
      display: block;
      min-height: 14px;
      border-radius: 999px;
      background: #dbeafe;
    }

    [data-gallery-route^="/components/"] progress {
      appearance: none;
      height: 14px;
      border: 0;
      border-radius: 999px;
      background: #e2e8f0;
      color: #2563eb;
    }

    [data-gallery-route^="/components/"] progress::-webkit-progress-bar {
      border-radius: 999px;
      background: #e2e8f0;
    }

    [data-gallery-route^="/components/"] progress::-webkit-progress-value {
      border-radius: 999px;
      background: #2563eb;
    }

    output {
      display: inline-block;
      min-width: 4ch;
      border-radius: 4px;
      padding: 2px 5px;
      background: #eef2ff;
      color: #3730a3;
    }
  `;
  document.head.append(style);
}

export function applyRouteCheckboxIndeterminate(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-state="indeterminate"]',
  )) {
    applyCheckboxIndeterminate(input, 'indeterminate');
  }
}

export async function expectNoAxeViolations(root: HTMLElement): Promise<void> {
  applyRouteCheckboxIndeterminate(root);

  const results = await axe.run(root);

  expect(formatAxeViolations(results.violations)).toEqual([]);
}

export function formatAxeViolations(violations: axe.Result[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => {
      const target = node.target.join(' ');
      return `${violation.id}: ${target}: ${node.failureSummary ?? violation.help}`;
    }),
  );
}
