import axe from 'axe-core';
import { installKovoLoader, type KovoLoader } from '@kovojs/browser/client';
import { applyCheckboxIndeterminate } from '@kovojs/headless-ui/checkbox';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as accordionClient from './interactive/accordion-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as alertDialogClient from './interactive/alert-dialog-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as autocompleteClient from './interactive/autocomplete-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as checkboxClient from './interactive/checkbox-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as checkboxGroupClient from './interactive/checkbox-group-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as collapsibleClient from './interactive/collapsible-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as comboboxClient from './interactive/combobox-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as commandClient from './interactive/command-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as contextMenuClient from './interactive/context-menu-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as disclosureClient from './interactive/disclosure-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as dialogClient from './interactive/dialog-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as drawerClient from './interactive/drawer-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as dropdownMenuClient from './interactive/dropdown-menu-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as fieldClient from './interactive/field-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as hoverCardClient from './interactive/hover-card-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as menubarClient from './interactive/menubar-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as meterClient from './interactive/meter-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as navigationMenuClient from './interactive/navigation-menu-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as numberFieldClient from './interactive/number-field-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as otpFieldClient from './interactive/otp-field-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as popoverClient from './interactive/popover-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as progressClient from './interactive/progress-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as pureMarkupClient from './interactive/pure-markup-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as radioGroupClient from './interactive/radio-group-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as scrollAreaClient from './interactive/scroll-area-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as selectClient from './interactive/select-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as sheetClient from './interactive/sheet-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as sliderClient from './interactive/slider-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as switchClient from './interactive/switch-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as tabsClient from './interactive/tabs-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as toolbarClient from './interactive/toolbar-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as toggleClient from './interactive/toggle-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as toggleGroupClient from './interactive/toggle-group-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as toastClient from './interactive/toast-demo.client.js';
// @ts-expect-error authored virtual client modules are compiler artifacts without declarations.
import * as tooltipClient from './interactive/tooltip-demo.client.js';
import accordionStaticRouteHtml from './visual-fixtures/accordion.html.txt?raw';
import alertStaticRouteHtml from './visual-fixtures/alert.html.txt?raw';
import alertDialogStaticRouteHtml from './visual-fixtures/alert-dialog.html.txt?raw';
import autocompleteStaticRouteHtml from './visual-fixtures/autocomplete.html.txt?raw';
import avatarStaticRouteHtml from './visual-fixtures/avatar.html.txt?raw';
import badgeStaticRouteHtml from './visual-fixtures/badge.html.txt?raw';
import breadcrumbStaticRouteHtml from './visual-fixtures/breadcrumb.html.txt?raw';
import buttonStaticRouteHtml from './visual-fixtures/button.html.txt?raw';
import cardStaticRouteHtml from './visual-fixtures/card.html.txt?raw';
import checkboxStaticRouteHtml from './visual-fixtures/checkbox.html.txt?raw';
import checkboxGroupStaticRouteHtml from './visual-fixtures/checkbox-group.html.txt?raw';
import collapsibleStaticRouteHtml from './visual-fixtures/collapsible.html.txt?raw';
import comboboxStaticRouteHtml from './visual-fixtures/combobox.html.txt?raw';
import commandStaticRouteHtml from './visual-fixtures/command.html.txt?raw';
import contextMenuStaticRouteHtml from './visual-fixtures/context-menu.html.txt?raw';
import dialogStaticRouteHtml from './visual-fixtures/dialog.html.txt?raw';
import disclosureStaticRouteHtml from './visual-fixtures/disclosure.html.txt?raw';
import drawerStaticRouteHtml from './visual-fixtures/drawer.html.txt?raw';
import dropdownMenuStaticRouteHtml from './visual-fixtures/dropdown-menu.html.txt?raw';
import fieldStaticRouteHtml from './visual-fixtures/field.html.txt?raw';
import hoverCardStaticRouteHtml from './visual-fixtures/hover-card.html.txt?raw';
import kbdStaticRouteHtml from './visual-fixtures/kbd.html.txt?raw';
import menubarStaticRouteHtml from './visual-fixtures/menubar.html.txt?raw';
import meterStaticRouteHtml from './visual-fixtures/meter.html.txt?raw';
import navigationMenuStaticRouteHtml from './visual-fixtures/navigation-menu.html.txt?raw';
import numberFieldStaticRouteHtml from './visual-fixtures/number-field.html.txt?raw';
import otpFieldStaticRouteHtml from './visual-fixtures/otp-field.html.txt?raw';
import popoverStaticRouteHtml from './visual-fixtures/popover.html.txt?raw';
import progressStaticRouteHtml from './visual-fixtures/progress.html.txt?raw';
import radioGroupStaticRouteHtml from './visual-fixtures/radio-group.html.txt?raw';
import scrollAreaStaticRouteHtml from './visual-fixtures/scroll-area.html.txt?raw';
import selectStaticRouteHtml from './visual-fixtures/select.html.txt?raw';
import separatorStaticRouteHtml from './visual-fixtures/separator.html.txt?raw';
import sheetStaticRouteHtml from './visual-fixtures/sheet.html.txt?raw';
import sliderStaticRouteHtml from './visual-fixtures/slider.html.txt?raw';
import skeletonStaticRouteHtml from './visual-fixtures/skeleton.html.txt?raw';
import switchStaticRouteHtml from './visual-fixtures/switch.html.txt?raw';
import tableStaticRouteHtml from './visual-fixtures/table.html.txt?raw';
import tabsStaticRouteHtml from './visual-fixtures/tabs.html.txt?raw';
import toastStaticRouteHtml from './visual-fixtures/toast.html.txt?raw';
import toggleStaticRouteHtml from './visual-fixtures/toggle.html.txt?raw';
import toggleGroupStaticRouteHtml from './visual-fixtures/toggle-group.html.txt?raw';
import toolbarStaticRouteHtml from './visual-fixtures/toolbar.html.txt?raw';
import tooltipStaticRouteHtml from './visual-fixtures/tooltip.html.txt?raw';

export interface InteractiveDemoComponent {
  definition: {
    render: (queries: Record<string, never>, state: never) => Promise<string> | string;
    state: () => unknown;
  };
}

export type StaticVisualFixturePath =
  | '/components/accordion'
  | '/components/alert'
  | '/components/alert-dialog'
  | '/components/autocomplete'
  | '/components/avatar'
  | '/components/badge'
  | '/components/breadcrumb'
  | '/components/button'
  | '/components/card'
  | '/components/checkbox'
  | '/components/checkbox-group'
  | '/components/collapsible'
  | '/components/combobox'
  | '/components/command'
  | '/components/context-menu'
  | '/components/dialog'
  | '/components/disclosure'
  | '/components/drawer'
  | '/components/dropdown-menu'
  | '/components/field'
  | '/components/hover-card'
  | '/components/kbd'
  | '/components/menubar'
  | '/components/meter'
  | '/components/navigation-menu'
  | '/components/number-field'
  | '/components/otp-field'
  | '/components/popover'
  | '/components/progress'
  | '/components/radio-group'
  | '/components/scroll-area'
  | '/components/select'
  | '/components/separator'
  | '/components/sheet'
  | '/components/slider'
  | '/components/skeleton'
  | '/components/switch'
  | '/components/table'
  | '/components/tabs'
  | '/components/toast'
  | '/components/toggle'
  | '/components/toggle-group'
  | '/components/toolbar'
  | '/components/tooltip';

export const staticVisualFixtureHtml: Record<StaticVisualFixturePath, string> = {
  '/components/accordion': accordionStaticRouteHtml,
  '/components/alert': alertStaticRouteHtml,
  '/components/alert-dialog': alertDialogStaticRouteHtml,
  '/components/autocomplete': autocompleteStaticRouteHtml,
  '/components/avatar': avatarStaticRouteHtml,
  '/components/badge': badgeStaticRouteHtml,
  '/components/breadcrumb': breadcrumbStaticRouteHtml,
  '/components/button': buttonStaticRouteHtml,
  '/components/card': cardStaticRouteHtml,
  '/components/checkbox': checkboxStaticRouteHtml,
  '/components/checkbox-group': checkboxGroupStaticRouteHtml,
  '/components/collapsible': collapsibleStaticRouteHtml,
  '/components/combobox': comboboxStaticRouteHtml,
  '/components/command': commandStaticRouteHtml,
  '/components/context-menu': contextMenuStaticRouteHtml,
  '/components/dialog': dialogStaticRouteHtml,
  '/components/disclosure': disclosureStaticRouteHtml,
  '/components/drawer': drawerStaticRouteHtml,
  '/components/dropdown-menu': dropdownMenuStaticRouteHtml,
  '/components/field': fieldStaticRouteHtml,
  '/components/hover-card': hoverCardStaticRouteHtml,
  '/components/kbd': kbdStaticRouteHtml,
  '/components/menubar': menubarStaticRouteHtml,
  '/components/meter': meterStaticRouteHtml,
  '/components/navigation-menu': navigationMenuStaticRouteHtml,
  '/components/number-field': numberFieldStaticRouteHtml,
  '/components/otp-field': otpFieldStaticRouteHtml,
  '/components/popover': popoverStaticRouteHtml,
  '/components/progress': progressStaticRouteHtml,
  '/components/radio-group': radioGroupStaticRouteHtml,
  '/components/scroll-area': scrollAreaStaticRouteHtml,
  '/components/select': selectStaticRouteHtml,
  '/components/separator': separatorStaticRouteHtml,
  '/components/sheet': sheetStaticRouteHtml,
  '/components/slider': sliderStaticRouteHtml,
  '/components/skeleton': skeletonStaticRouteHtml,
  '/components/switch': switchStaticRouteHtml,
  '/components/table': tableStaticRouteHtml,
  '/components/tabs': tabsStaticRouteHtml,
  '/components/toast': toastStaticRouteHtml,
  '/components/toggle': toggleStaticRouteHtml,
  '/components/toggle-group': toggleGroupStaticRouteHtml,
  '/components/toolbar': toolbarStaticRouteHtml,
  '/components/tooltip': tooltipStaticRouteHtml,
};

export const interactiveClientModules: Record<string, Record<string, unknown>> = {
  '/c/src/interactive/accordion-demo.client.js': accordionClient,
  '/c/src/interactive/alert-dialog-demo.client.js': alertDialogClient,
  '/c/src/interactive/autocomplete-demo.client.js': autocompleteClient,
  '/c/src/interactive/checkbox-demo.client.js': checkboxClient,
  '/c/src/interactive/checkbox-group-demo.client.js': checkboxGroupClient,
  '/c/src/interactive/collapsible-demo.client.js': collapsibleClient,
  '/c/src/interactive/combobox-demo.client.js': comboboxClient,
  '/c/src/interactive/command-demo.client.js': commandClient,
  '/c/src/interactive/context-menu-demo.client.js': contextMenuClient,
  '/c/src/interactive/disclosure-demo.client.js': disclosureClient,
  '/c/src/interactive/dialog-demo.client.js': dialogClient,
  '/c/src/interactive/drawer-demo.client.js': drawerClient,
  '/c/src/interactive/dropdown-menu-demo.client.js': dropdownMenuClient,
  '/c/src/interactive/field-demo.client.js': fieldClient,
  '/c/src/interactive/hover-card-demo.client.js': hoverCardClient,
  '/c/src/interactive/menubar-demo.client.js': menubarClient,
  '/c/src/interactive/meter-demo.client.js': meterClient,
  '/c/src/interactive/navigation-menu-demo.client.js': navigationMenuClient,
  '/c/src/interactive/number-field-demo.client.js': numberFieldClient,
  '/c/src/interactive/otp-field-demo.client.js': otpFieldClient,
  '/c/src/interactive/popover-demo.client.js': popoverClient,
  '/c/src/interactive/progress-demo.client.js': progressClient,
  '/c/src/interactive/pure-markup-demo.client.js': pureMarkupClient,
  '/c/src/interactive/radio-group-demo.client.js': radioGroupClient,
  '/c/src/interactive/scroll-area-demo.client.js': scrollAreaClient,
  '/c/src/interactive/select-demo.client.js': selectClient,
  '/c/src/interactive/sheet-demo.client.js': sheetClient,
  '/c/src/interactive/slider-demo.client.js': sliderClient,
  '/c/src/interactive/switch-demo.client.js': switchClient,
  '/c/src/interactive/tabs-demo.client.js': tabsClient,
  '/c/src/interactive/toolbar-demo.client.js': toolbarClient,
  '/c/src/interactive/toggle-demo.client.js': toggleClient,
  '/c/src/interactive/toggle-group-demo.client.js': toggleGroupClient,
  '/c/src/interactive/toast-demo.client.js': toastClient,
  '/c/src/interactive/tooltip-demo.client.js': tooltipClient,
};

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

function normalizeInteractiveClientModulePath(url: string): string {
  const modulePath = url.split('?')[0] ?? url;
  const versioned = /^\/c\/__v\/[^/]+\/(.+)$/.exec(modulePath);

  return versioned ? `/c/${versioned[1]}` : modulePath;
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
