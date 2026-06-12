import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const galleryRoot = resolve(import.meta.dirname, '..');

type ClientExports = Record<
  string,
  (
    event: Event,
    ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
  ) => void
>;

describe('compiled interactive gallery demos', () => {
  it('keeps generated interactive artifacts in sync with app-authored TSX', () => {
    execFileSync(process.execPath, ['scripts/emit-interactive-gallery.mjs', '--check'], {
      cwd: galleryRoot,
      stdio: 'pipe',
    });
  }, 20_000);

  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const alertDialog = readGenerated('alert-dialog-demo.tsx');
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const collapsible = readGenerated('collapsible-demo.tsx');
    const disclosure = readGenerated('disclosure-demo.tsx');
    const dialog = readGenerated('dialog-demo.tsx');
    const numberField = readGenerated('number-field-demo.tsx');
    const popover = readGenerated('popover-demo.tsx');
    const switchDemo = readGenerated('switch-demo.tsx');
    const tabs = readGenerated('tabs-demo.tsx');
    const tooltip = readGenerated('tooltip-demo.tsx');

    expect(alertDialog).toContain('data-gallery-interactive="alert-dialog"');
    expect(alertDialog).toContain('fw-state=\'{"open":false}\'');
    expect(alertDialog).toContain('alertDialogTriggerAttributes({ contentId, open: state.open })');
    expect(alertDialog).toContain('alertDialogCancelAttributes({');
    expect(alertDialog).toContain("intent: 'destructive'");
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click"/,
    );
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_2"/,
    );
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_3"/,
    );

    expect(toggle).toContain('data-gallery-interactive="toggle"');
    expect(toggle).toContain('fw-state=\'{"pressed":false}\'');
    expect(toggle).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleDemo\$button_click"/,
    );

    expect(checkbox).toContain('data-gallery-interactive="checkbox"');
    expect(checkbox).toContain('fw-state=\'{"checked":"indeterminate"}\'');
    expect(checkbox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxDemo\$input_click"/,
    );

    expect(disclosure).toContain('data-gallery-interactive="disclosure"');
    expect(disclosure).toContain('fw-state=\'{"open":false}\'');
    expect(disclosure).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/disclosure-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDisclosureDemo\$button_click"/,
    );

    expect(dialog).toContain('data-gallery-interactive="dialog"');
    expect(dialog).toContain('fw-state=\'{"open":false}\'');
    expect(dialog).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(dialog).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click"/,
    );
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click_2"/,
    );

    expect(numberField).toContain('data-gallery-interactive="number-field"');
    expect(numberField).toContain('fw-state=\'{"value":2}\'');
    expect(numberField).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$button_click"/,
    );
    expect(numberField).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$button_click_2"/,
    );

    expect(collapsible).toContain('data-gallery-interactive="collapsible"');
    expect(collapsible).toContain('fw-state=\'{"open":false}\'');
    expect(collapsible).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/collapsible-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCollapsibleDemo\$summary_click"/,
    );

    expect(popover).toContain('data-gallery-interactive="popover"');
    expect(popover).toContain('fw-state=\'{"open":false}\'');
    expect(popover).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$button_click"/,
    );

    expect(switchDemo).toContain('data-gallery-interactive="switch"');
    expect(switchDemo).toContain('fw-state=\'{"checked":false}\'');
    expect(switchDemo).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/switch-demo\.client\.js\?v=[0-9a-f]{8}#GallerySwitchDemo\$input_click"/,
    );

    expect(tabs).toContain('data-gallery-interactive="tabs"');
    expect(tabs).toContain('fw-state=\'{"value":"overview"}\'');
    expect(tabs).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTabsDemo\$div_keydown"/,
    );
    expect(tabs).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTabsDemo\$button_click_2"/,
    );

    expect(tooltip).toContain('data-gallery-interactive="tooltip"');
    expect(tooltip).toContain('fw-state=\'{"open":false}\'');
    expect(tooltip).toContain('tooltipTriggerAttributes({ contentId, open: state.open })');
    expect(tooltip).toMatch(
      /on:focus="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_focus"/,
    );
    expect(tooltip).toMatch(
      /on:pointerenter="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_pointerenter"/,
    );
    expect(tooltip).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_keydown"/,
    );
  });

  it('executes generated client behavior for the stateful demos', () => {
    const alertDialog = evaluateClientModule('alert-dialog-demo.client.js');
    const toggle = evaluateClientModule('toggle-demo.client.js');
    const checkbox = evaluateClientModule('checkbox-demo.client.js');
    const collapsible = evaluateClientModule('collapsible-demo.client.js');
    const disclosure = evaluateClientModule('disclosure-demo.client.js');
    const dialog = evaluateClientModule('dialog-demo.client.js');
    const numberField = evaluateClientModule('number-field-demo.client.js');
    const popover = evaluateClientModule('popover-demo.client.js');
    const switchDemo = evaluateClientModule('switch-demo.client.js');
    const tabs = evaluateClientModule('tabs-demo.client.js');
    const tooltip = evaluateClientModule('tooltip-demo.client.js');
    const signal = new AbortController().signal;

    const alertDialogState = { open: false };
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: true });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });

    const toggleState = { pressed: false };
    clientHandler(toggle, 'GalleryToggleDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: toggleState,
    });
    expect(toggleState).toEqual({ pressed: true });

    const checkboxState = { checked: 'indeterminate' };
    clientHandler(checkbox, 'GalleryCheckboxDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: checkboxState,
    });
    expect(checkboxState).toEqual({ checked: true });

    const disclosureState = { open: false };
    clientHandler(disclosure, 'GalleryDisclosureDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: disclosureState,
    });
    expect(disclosureState).toEqual({ open: true });

    const dialogState = { open: false };
    clientHandler(dialog, 'GalleryDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: true });
    clientHandler(dialog, 'GalleryDialogDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });

    const numberFieldState = { value: 2 };
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 3 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 2 });

    const collapsibleState = { open: false };
    clientHandler(collapsible, 'GalleryCollapsibleDemo$summary_click')(new Event('click'), {
      params: {},
      signal,
      state: collapsibleState,
    });
    expect(collapsibleState).toEqual({ open: true });

    const popoverState = { open: false };
    clientHandler(popover, 'GalleryPopoverDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: true });

    const switchState = { checked: false };
    clientHandler(switchDemo, 'GallerySwitchDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: switchState,
    });
    expect(switchState).toEqual({ checked: true });

    const tabsState = { value: 'overview' };
    clientHandler(tabs, 'GalleryTabsDemo$div_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ value: 'details' });
    clientHandler(tabs, 'GalleryTabsDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ value: 'overview' });

    const tooltipState = { open: false };
    clientHandler(tooltip, 'GalleryTooltipDemo$button_focus')(new Event('focus'), {
      params: {},
      signal,
      state: tooltipState,
    });
    expect(tooltipState).toEqual({ open: true });
    clientHandler(tooltip, 'GalleryTooltipDemo$button_keydown')(
      Object.assign(new Event('keydown'), { key: 'Escape' }),
      {
        params: {},
        signal,
        state: tooltipState,
      },
    );
    expect(tooltipState).toEqual({ open: false });
  });
});

function readGenerated(fileName: string): string {
  return readFileSync(resolve(galleryRoot, `src/generated/interactive/${fileName}`), 'utf8');
}

function evaluateClientModule(fileName: string): ClientExports {
  const source = readGenerated(fileName)
    .replace("import { handler } from '@jiso/runtime';\n\n", '')
    .replaceAll('export const ', 'exports.');
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    exports,
    handler: (fn: ClientExports[string]) => fn,
  });

  return exports;
}

function clientHandler(exports: ClientExports, name: string): ClientExports[string] {
  const fn = exports[name];
  if (fn === undefined) throw new Error(`Missing generated handler export: ${name}`);

  return fn;
}
