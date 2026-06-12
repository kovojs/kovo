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
    const accordion = readGenerated('accordion-demo.tsx');
    const alertDialog = readGenerated('alert-dialog-demo.tsx');
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const checkboxGroup = readGenerated('checkbox-group-demo.tsx');
    const collapsible = readGenerated('collapsible-demo.tsx');
    const disclosure = readGenerated('disclosure-demo.tsx');
    const dialog = readGenerated('dialog-demo.tsx');
    const numberField = readGenerated('number-field-demo.tsx');
    const otpField = readGenerated('otp-field-demo.tsx');
    const popover = readGenerated('popover-demo.tsx');
    const radioGroup = readGenerated('radio-group-demo.tsx');
    const slider = readGenerated('slider-demo.tsx');
    const switchDemo = readGenerated('switch-demo.tsx');
    const tabs = readGenerated('tabs-demo.tsx');
    const toolbar = readGenerated('toolbar-demo.tsx');
    const tooltip = readGenerated('tooltip-demo.tsx');
    const toggleGroup = readGenerated('toggle-group-demo.tsx');

    expect(accordion).toContain('data-gallery-interactive="accordion"');
    expect(accordion).toContain('fw-state=\'{"value":"shipping"}\'');
    expect(accordion).toContain('accordionTriggerAttributes({');
    expect(accordion).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAccordionDemo\$button_click"/,
    );
    expect(accordion).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAccordionDemo\$button_click_2"/,
    );

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

    expect(checkboxGroup).toContain('data-gallery-interactive="checkbox-group"');
    expect(checkboxGroup).toContain('fw-state=\'{"activeValue":"updates","value":"updates"}\'');
    expect(checkboxGroup).toContain('checkboxGroupControlAttributes({');
    expect(checkboxGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$section_keydown"/,
    );
    expect(checkboxGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$input_click_2"/,
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

    expect(otpField).toContain('data-gallery-interactive="otp-field"');
    expect(otpField).toContain('fw-state=\'{"activeSlot":2,"value":"12"}\'');
    expect(otpField).toContain('otpFieldHiddenInputAttributes({');
    expect(otpField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_input"/,
    );
    expect(otpField).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_keydown_2"/,
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

    expect(radioGroup).toContain('data-gallery-interactive="radio-group"');
    expect(radioGroup).toContain('fw-state=\'{"value":"email"}\'');
    expect(radioGroup).toContain('radioGroupRadioAttributes({');
    expect(radioGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$section_keydown"/,
    );
    expect(radioGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$input_click_2"/,
    );

    expect(slider).toContain('data-gallery-interactive="slider"');
    expect(slider).toContain('fw-state=\'{"value":25}\'');
    expect(slider).toContain('sliderInputAttributes(sliderState)');
    expect(slider).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js\?v=[0-9a-f]{8}#GallerySliderDemo\$input_input"/,
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

    expect(toolbar).toContain('data-gallery-interactive="toolbar"');
    expect(toolbar).toContain('fw-state=\'{"activeValue":"bold","pressedValue":"bold"}\'');
    expect(toolbar).toContain('toolbarButtonAttributes({');
    expect(toolbar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToolbarDemo\$section_keydown"/,
    );
    expect(toolbar).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToolbarDemo\$button_click_2"/,
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

    expect(toggleGroup).toContain('data-gallery-interactive="toggle-group"');
    expect(toggleGroup).toContain('fw-state=\'{"activeValue":"bold","value":"bold"}\'');
    expect(toggleGroup).toContain('toggleGroupButtonAttributes({');
    expect(toggleGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleGroupDemo\$section_keydown"/,
    );
    expect(toggleGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleGroupDemo\$button_click_2"/,
    );
  });

  it('executes generated client behavior for the stateful demos', () => {
    const accordion = evaluateClientModule('accordion-demo.client.js');
    const alertDialog = evaluateClientModule('alert-dialog-demo.client.js');
    const toggle = evaluateClientModule('toggle-demo.client.js');
    const checkbox = evaluateClientModule('checkbox-demo.client.js');
    const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js');
    const collapsible = evaluateClientModule('collapsible-demo.client.js');
    const disclosure = evaluateClientModule('disclosure-demo.client.js');
    const dialog = evaluateClientModule('dialog-demo.client.js');
    const numberField = evaluateClientModule('number-field-demo.client.js');
    const otpField = evaluateClientModule('otp-field-demo.client.js');
    const popover = evaluateClientModule('popover-demo.client.js');
    const radioGroup = evaluateClientModule('radio-group-demo.client.js');
    const slider = evaluateClientModule('slider-demo.client.js');
    const switchDemo = evaluateClientModule('switch-demo.client.js');
    const tabs = evaluateClientModule('tabs-demo.client.js');
    const toolbar = evaluateClientModule('toolbar-demo.client.js');
    const tooltip = evaluateClientModule('tooltip-demo.client.js');
    const toggleGroup = evaluateClientModule('toggle-group-demo.client.js');
    const signal = new AbortController().signal;

    const accordionState = { value: 'shipping' };
    clientHandler(accordion, 'GalleryAccordionDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: accordionState,
    });
    expect(accordionState).toEqual({ value: 'billing' });

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

    const checkboxGroupState = { activeValue: 'updates', value: 'updates' };
    clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: checkboxGroupState,
    });
    expect(checkboxGroupState).toEqual({ activeValue: 'billing', value: 'updates' });
    clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$input_click_2')(new Event('click'), {
      params: {},
      signal,
      state: checkboxGroupState,
    });
    expect(checkboxGroupState).toEqual({
      activeValue: 'billing',
      value: 'updates,billing',
    });

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

    const otpFieldState = { activeSlot: 2, value: '12' };
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '123' });
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input_2')(new Event('input'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '1234' });
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_keydown_2')(new Event('keydown'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 1, value: '1' });

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

    const radioGroupState = { value: 'email' };
    clientHandler(radioGroup, 'GalleryRadioGroupDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: radioGroupState,
    });
    expect(radioGroupState).toEqual({ value: 'sms' });
    clientHandler(radioGroup, 'GalleryRadioGroupDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: radioGroupState,
    });
    expect(radioGroupState).toEqual({ value: 'email' });

    const sliderState = { value: 25 };
    clientHandler(slider, 'GallerySliderDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: sliderState,
    });
    expect(sliderState).toEqual({ value: 75 });

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

    const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
    clientHandler(toolbar, 'GalleryToolbarDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'bold' });
    clientHandler(toolbar, 'GalleryToolbarDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'link' });

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

    const toggleGroupState = { activeValue: 'bold', value: 'bold' };
    clientHandler(toggleGroup, 'GalleryToggleGroupDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: toggleGroupState,
    });
    expect(toggleGroupState).toEqual({ activeValue: 'italic', value: 'bold' });
    clientHandler(toggleGroup, 'GalleryToggleGroupDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toggleGroupState,
    });
    expect(toggleGroupState).toEqual({ activeValue: 'italic', value: 'bold,italic' });
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
