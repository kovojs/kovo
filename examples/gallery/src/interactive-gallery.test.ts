import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { galleryInteractiveClientModuleHrefs } from './app-shell.js';
import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const galleryRoot = resolve(import.meta.dirname, '..');

type ClientExports = Record<
  string,
  (
    event: Event,
    ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
  ) => void
>;

interface FakeElement {
  checked?: boolean;
  close?: () => void;
  hidden?: boolean;
  focus?: () => void;
  readonly setAttribute: (name: string, value: string) => void;
  scrollTop?: number;
  tabIndex?: number;
  textContent?: string;
  value?: string;
  readonly attrs: Record<string, string>;
  closeCalls: number;
  focusCalls: number;
}

interface FakeDocument {
  readonly byId: Map<string, FakeElement>;
  readonly bySelector: Map<string, FakeElement>;
  readonly getElementById: (id: string) => FakeElement | undefined;
  readonly querySelector: (selector: string) => FakeElement | undefined;
}

describe('compiled interactive gallery demos', () => {
  it('keeps generated interactive artifacts in sync with app-authored TSX', () => {
    execFileSync(process.execPath, ['scripts/emit-interactive-gallery.mjs', '--check'], {
      cwd: galleryRoot,
      stdio: 'pipe',
    });
  }, 60_000);

  it('wires every compiled interactive demo into the docs gallery route', () => {
    const packageJson = JSON.parse(readFileSync(resolve(galleryRoot, 'package.json'), 'utf8')) as {
      jiso?: { interactiveGallery?: { compiledDemos?: unknown } };
    };
    const manifestDemos = packageJson.jiso?.interactiveGallery?.compiledDemos;
    const generatedDemos = readdirSync(resolve(galleryRoot, 'src/generated/interactive'))
      .filter((fileName) => fileName.endsWith('-demo.tsx'))
      .map((fileName) => fileName.replace(/\.tsx$/, ''))
      .sort(compareStrings);
    const docsDemos = interactiveGalleryDemos.map((demo) => demo.name).sort(compareStrings);

    expect(
      Array.isArray(manifestDemos) ? [...manifestDemos].map(String).sort(compareStrings) : [],
    ).toEqual(generatedDemos);
    expect(docsDemos).toEqual(generatedDemos);

    const html = renderInteractiveGalleryRoute();
    expect(html).toContain('data-gallery-route="/gallery/interactive"');
    expect(html).toContain('data-demo-summary="compiled"');

    for (const demo of generatedDemos) {
      const componentName = demo.replace(/-demo$/, '');
      expect(html).toContain(`href="#${demo}"`);
      expect(html).toContain(`data-gallery-interactive="${componentName}"`);
      expect(html).toContain(`/c/examples/gallery/src/generated/interactive/${demo}.client.js`);
    }
  });

  it('exports the compiled interactive docs route and client modules for static deployment', () => {
    const distDir = resolve(galleryRoot, 'dist');
    rmSync(distDir, { force: true, recursive: true });

    try {
      const output = execFileSync('pnpm', ['exec', 'vp', 'run', '--no-cache', 'export'], {
        cwd: galleryRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      expect(output).toContain('gallery-interactive-export/v1');
      expect(output).toContain('html=1');
      expect(output).toContain(`client-modules=${interactiveGalleryDemos.length}`);
      expect(output).toContain('diagnostics=0');

      const html = readFileSync(join(distDir, 'gallery/interactive/index.html'), 'utf8');
      expect(html).toContain('<title>Jiso Interactive Gallery</title>');
      expect(html).toContain('data-gallery-route="/gallery/interactive"');
      expect(html).toContain('data-gallery-interactive="progress"');
      expect(html).toContain('data-gallery-interactive="meter"');

      for (const href of galleryInteractiveClientModuleHrefs) {
        expect(html).toContain(`<link rel="modulepreload" href="${href}">`);
        const modulePath = href.replace(/^\//, '').replace(/\?v=[0-9a-f]{8}$/, '');
        expect(existsSync(join(distDir, modulePath)), `${modulePath} was exported`).toBe(true);
      }

      const progressClient = readFileSync(
        join(distDir, 'c/examples/gallery/src/generated/interactive/progress-demo.client.js'),
        'utf8',
      );
      expect(progressClient).toContain('GalleryProgressDemo$button_click');
    } finally {
      rmSync(distDir, { force: true, recursive: true });
    }
  }, 60_000);

  it('keeps rendered generated-client DOM refs in lockstep with client exports', () => {
    for (const demo of generatedInteractiveDemoNames()) {
      const componentName = demo.replace(/-demo$/, '');
      const expectedModulePath = `/c/examples/gallery/src/generated/interactive/${demo}.client.js`;
      const clientExports = extractClientExports(readGenerated(`${demo}.client.js`));
      const loweredRefs = extractGeneratedClientRefs(readGenerated(`${demo}.tsx`));
      const renderedDemo = interactiveGalleryDemos.find((entry) => entry.name === demo);
      if (renderedDemo === undefined) throw new Error(`Missing docs route demo: ${demo}`);

      const renderedRefs = extractGeneratedClientRefs(renderedDemo.render());

      expect(clientExports, `${demo} client exports`).not.toEqual([]);
      expect(renderedRefs, `${demo} rendered refs`).toEqual(loweredRefs);
      expect(
        renderedRefs.map((ref) => ref.modulePath),
        `${demo} module paths`,
      ).toEqual(renderedRefs.map(() => expectedModulePath));
      expect(
        renderedRefs.map((ref) => ref.version),
        `${demo} version stamps`,
      ).toEqual(renderedRefs.map(() => expect.stringMatching(/^[0-9a-f]{8}$/)));
      expect(renderedRefs.map((ref) => ref.exportName).sort(compareStrings)).toEqual(clientExports);

      for (const ref of renderedRefs) {
        expect(ref.exportName, `${demo} ${ref.eventName} ref`).toMatch(
          new RegExp(
            `^Gallery${pascalCase(componentName)}Demo\\$[A-Za-z0-9]+_${ref.eventName}(?:_\\d+)?$`,
          ),
        );
      }
    }
  });

  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const accordion = readGenerated('accordion-demo.tsx');
    const alertDialog = readGenerated('alert-dialog-demo.tsx');
    const autocomplete = readGenerated('autocomplete-demo.tsx');
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const checkboxGroup = readGenerated('checkbox-group-demo.tsx');
    const collapsible = readGenerated('collapsible-demo.tsx');
    const combobox = readGenerated('combobox-demo.tsx');
    const command = readGenerated('command-demo.tsx');
    const contextMenu = readGenerated('context-menu-demo.tsx');
    const disclosure = readGenerated('disclosure-demo.tsx');
    const dialog = readGenerated('dialog-demo.tsx');
    const dropdownMenu = readGenerated('dropdown-menu-demo.tsx');
    const field = readGenerated('field-demo.tsx');
    const hoverCard = readGenerated('hover-card-demo.tsx');
    const menubar = readGenerated('menubar-demo.tsx');
    const meter = readGenerated('meter-demo.tsx');
    const navigationMenu = readGenerated('navigation-menu-demo.tsx');
    const numberField = readGenerated('number-field-demo.tsx');
    const otpField = readGenerated('otp-field-demo.tsx');
    const popover = readGenerated('popover-demo.tsx');
    const progress = readGenerated('progress-demo.tsx');
    const radioGroup = readGenerated('radio-group-demo.tsx');
    const scrollArea = readGenerated('scroll-area-demo.tsx');
    const select = readGenerated('select-demo.tsx');
    const slider = readGenerated('slider-demo.tsx');
    const switchDemo = readGenerated('switch-demo.tsx');
    const tabs = readGenerated('tabs-demo.tsx');
    const toolbar = readGenerated('toolbar-demo.tsx');
    const tooltip = readGenerated('tooltip-demo.tsx');
    const toggleGroup = readGenerated('toggle-group-demo.tsx');
    const toggleGroupClient = readGenerated('toggle-group-demo.client.js');
    const toast = readGenerated('toast-demo.tsx');

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
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$dialog_cancel"/,
    );
    expect(alertDialog).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$section_keydown"/,
    );
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_2"/,
    );
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_3"/,
    );

    expect(autocomplete).toContain('data-gallery-interactive="autocomplete"');
    expect(autocomplete).toContain(
      'fw-state=\'{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}\'',
    );
    expect(autocomplete).toContain('autocompleteInputAttributes({');
    expect(autocomplete).toContain('autocompleteOptionAttributes({');
    expect(autocomplete).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_input"/,
    );
    expect(autocomplete).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_keydown"/,
    );
    expect(autocomplete).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$option_click"/,
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
    expect(checkboxGroup).toContain('id="gallery-checkbox-group-form"');
    expect(checkboxGroup).toContain("form: 'gallery-checkbox-group-form'");
    expect(checkboxGroup).toContain('checkboxGroupControlAttributes({');
    expect(checkboxGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$section_keydown"/,
    );
    expect(checkboxGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$input_click_2"/,
    );

    expect(combobox).toContain('data-gallery-interactive="combobox"');
    expect(combobox).toContain(
      'fw-state=\'{"highlightedValue":"austin","open":false,"value":"austin"}\'',
    );
    expect(combobox).toContain('comboboxInputAttributes({');
    expect(combobox).toContain('comboboxListboxAttributes({');
    expect(combobox).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_input"/,
    );
    expect(combobox).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_keydown"/,
    );
    expect(combobox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$button_click"/,
    );

    expect(command).toContain('data-gallery-interactive="command"');
    expect(command).toContain(
      'fw-state=\'{"highlightedValue":"dashboard","inputValue":"","open":false,"value":"dashboard"}\'',
    );
    expect(command).toContain(
      "{ id: 'gallery-command-listbox-item-1', label: 'Invite teammate', value: 'invite' }",
    );
    expect(command).toContain('commandDialogAttributes({');
    expect(command).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_input"/,
    );
    expect(command).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_keydown"/,
    );
    expect(command).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$button_click_2"/,
    );

    expect(contextMenu).toContain('data-gallery-interactive="context-menu"');
    expect(contextMenu).toContain(
      'fw-state=\'{"highlightedValue":"copy","open":false,"value":"copy"}\'',
    );
    expect(contextMenu).toContain('contextMenuTriggerAttributes({');
    expect(contextMenu).toMatch(
      /on:contextmenu="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$div_contextmenu"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_click"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_keydown"/,
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
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$dialog_cancel"/,
    );
    expect(dialog).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$section_keydown"/,
    );
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click_2"/,
    );

    expect(dropdownMenu).toContain('data-gallery-interactive="dropdown-menu"');
    expect(dropdownMenu).toContain(
      'fw-state=\'{"highlightedValue":"duplicate","open":false,"value":"duplicate"}\'',
    );
    expect(dropdownMenu).toContain('dropdownMenuContentAttributes({');
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_click"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$div_keydown"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_keydown"/,
    );

    expect(field).toContain('data-gallery-interactive="field"');
    expect(field).toContain(
      'fw-state=\'{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}\'',
    );
    expect(field).toContain('fieldControlAttributes({');
    expect(field).toContain('fieldsetRootAttributes({');
    expect(field).toContain("name: 'gallery-shipping'");
    expect(field).toContain('name="gallery-seat"');
    expect(field).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$input_input"/,
    );
    expect(field).toMatch(
      /on:change="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$select_change"/,
    );
    expect(field).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$input_click"/,
    );

    expect(hoverCard).toContain('data-gallery-interactive="hover-card"');
    expect(hoverCard).toContain('fw-state=\'{"open":false}\'');
    expect(hoverCard).toContain('hoverCardTriggerAttributes({ contentId, open: state.open })');
    expect(hoverCard).toMatch(
      /on:focus="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_focus"/,
    );
    expect(hoverCard).toMatch(
      /on:pointerenter="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_pointerenter"/,
    );
    expect(hoverCard).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_keydown"/,
    );

    expect(menubar).toContain('data-gallery-interactive="menubar"');
    expect(menubar).toContain('fw-state=\'{"activeValue":"file","openValue":"","value":"new"}\'');
    expect(menubar).toContain('menubarSubmenuAttributes({');
    expect(menubar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$section_keydown"/,
    );
    expect(menubar).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$button_click"/,
    );
    expect(menubar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$button_keydown"/,
    );

    expect(meter).toContain('data-gallery-interactive="meter"');
    expect(meter).toContain('fw-state=\'{"value":72}\'');
    expect(meter).toContain('meterRootAttributes(meterState)');
    expect(meter).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/meter-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMeterDemo\$button_click"/,
    );

    expect(navigationMenu).toContain('data-gallery-interactive="navigation-menu"');
    expect(navigationMenu).toContain(
      'fw-state=\'{"activeValue":"products","openValue":"","value":"none"}\'',
    );
    expect(navigationMenu).toContain('navigationMenuTriggerAttributes({');
    expect(navigationMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNavigationMenuDemo\$section_keydown"/,
    );
    expect(navigationMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNavigationMenuDemo\$a_click"/,
    );

    expect(numberField).toContain('data-gallery-interactive="number-field"');
    expect(numberField).toContain('fw-state=\'{"value":2}\'');
    expect(numberField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$input_input"/,
    );
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
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$section_keydown"/,
    );
    expect(popover).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$button_click"/,
    );

    expect(progress).toContain('data-gallery-interactive="progress"');
    expect(progress).toContain('fw-state=\'{"value":40}\'');
    expect(progress).toContain(
      'progressRootAttributes({ max: 100, value: state.value, valueText })',
    );
    expect(progress).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js\?v=[0-9a-f]{8}#GalleryProgressDemo\$button_click"/,
    );
    expect(progress).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js\?v=[0-9a-f]{8}#GalleryProgressDemo\$button_click_2"/,
    );

    expect(radioGroup).toContain('data-gallery-interactive="radio-group"');
    expect(radioGroup).toContain('id="gallery-radio-form" data-gallery-form="radio-group"');
    expect(radioGroup).toContain("form: 'gallery-radio-form'");
    expect(radioGroup).toContain('fw-state=\'{"value":"email"}\'');
    expect(radioGroup).toContain('radioGroupRadioAttributes({');
    expect(radioGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$section_keydown"/,
    );
    expect(radioGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$input_click_2"/,
    );

    expect(scrollArea).toContain('data-gallery-interactive="scroll-area"');
    expect(scrollArea).toContain('fw-state=\'{"position":"top"}\'');
    expect(scrollArea).toContain('scrollAreaViewportAttributes({');
    expect(scrollArea).toContain('scrollAreaThumbAttributes({');
    expect(scrollArea).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js\?v=[0-9a-f]{8}#GalleryScrollAreaDemo\$button_click"/,
    );

    expect(select).toContain('data-gallery-interactive="select"');
    expect(select).toContain('fw-state=\'{"value":"standard"}\'');
    expect(select).toContain('selectTriggerAttributes({');
    expect(select).toContain('selectItemAttributes({');
    expect(select).toMatch(
      /on:change="\/c\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js\?v=[0-9a-f]{8}#GallerySelectDemo\$select_change"/,
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
    expect(tabs).toContain('fw-state=\'{"activeValue":"overview","value":"overview"}\'');
    expect(tabs).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTabsDemo\$section_keydown"/,
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
    expect(toggleGroupClient).toContain("Object(italic)['focus']?.call(italic)");

    expect(toast).toContain('data-gallery-interactive="toast"');
    expect(toast).toContain('fw-state=\'{"open":true}\'');
    expect(toast).toContain('toastRootAttributes(toastState)');
    expect(toast).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$section_keydown"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$button_click_2"/,
    );
  });

  it('executes generated client behavior for the stateful demos', () => {
    const accordion = evaluateClientModule('accordion-demo.client.js');
    const alertDialog = evaluateClientModule('alert-dialog-demo.client.js');
    const autocomplete = evaluateClientModule('autocomplete-demo.client.js');
    const toggle = evaluateClientModule('toggle-demo.client.js');
    const checkbox = evaluateClientModule('checkbox-demo.client.js');
    const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js');
    const collapsible = evaluateClientModule('collapsible-demo.client.js');
    const combobox = evaluateClientModule('combobox-demo.client.js');
    const command = evaluateClientModule('command-demo.client.js');
    const contextMenu = evaluateClientModule('context-menu-demo.client.js');
    const disclosure = evaluateClientModule('disclosure-demo.client.js');
    const dialog = evaluateClientModule('dialog-demo.client.js');
    const dropdownMenu = evaluateClientModule('dropdown-menu-demo.client.js');
    const field = evaluateClientModule('field-demo.client.js');
    const hoverCard = evaluateClientModule('hover-card-demo.client.js');
    const menubar = evaluateClientModule('menubar-demo.client.js');
    const meter = evaluateClientModule('meter-demo.client.js');
    const navigationMenu = evaluateClientModule('navigation-menu-demo.client.js');
    const numberField = evaluateClientModule('number-field-demo.client.js');
    const otpField = evaluateClientModule('otp-field-demo.client.js');
    const popover = evaluateClientModule('popover-demo.client.js');
    const progress = evaluateClientModule('progress-demo.client.js');
    const radioGroup = evaluateClientModule('radio-group-demo.client.js');
    const scrollArea = evaluateClientModule('scroll-area-demo.client.js');
    const select = evaluateClientModule('select-demo.client.js');
    const slider = evaluateClientModule('slider-demo.client.js');
    const switchDemo = evaluateClientModule('switch-demo.client.js');
    const tabs = evaluateClientModule('tabs-demo.client.js');
    const toolbar = evaluateClientModule('toolbar-demo.client.js');
    const tooltip = evaluateClientModule('tooltip-demo.client.js');
    const toggleGroup = evaluateClientModule('toggle-group-demo.client.js');
    const toast = evaluateClientModule('toast-demo.client.js');
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
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$dialog_cancel')(new Event('cancel'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    alertDialogState.open = true;
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    alertDialogState.open = true;
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

    const autocompleteState = {
      highlightedValue: 'design',
      inputValue: 'de',
      open: false,
      value: 'design',
    };
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'dev',
      open: true,
      value: 'design',
    });
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'development',
      open: false,
      value: 'development',
    });
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$option_click')(new Event('click'), {
      params: { value: 'development' },
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'development',
      open: false,
      value: 'development',
    });

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
    const checkboxGroupKeyboardEvent = keyEvent('ArrowRight');
    clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$section_keydown')(
      checkboxGroupKeyboardEvent,
      {
        params: {},
        signal,
        state: checkboxGroupState,
      },
    );
    expect(checkboxGroupKeyboardEvent.defaultPrevented).toBe(true);
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

    const comboboxState = { highlightedValue: 'austin', open: false, value: 'austin' };
    clientHandler(combobox, 'GalleryComboboxDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'chicago', open: true, value: 'chicago' });
    clientHandler(combobox, 'GalleryComboboxDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'chicago', open: false, value: 'chicago' });
    clientHandler(combobox, 'GalleryComboboxDemo$button_click')(new Event('click'), {
      params: { value: 'austin' },
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'austin', open: false, value: 'austin' });

    const commandState = {
      highlightedValue: 'dashboard',
      inputValue: '',
      open: false,
      value: 'dashboard',
    };
    clientHandler(command, 'GalleryCommandDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'dashboard',
      inputValue: '',
      open: true,
      value: 'dashboard',
    });
    clientHandler(command, 'GalleryCommandDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      open: true,
      value: 'dashboard',
    });
    clientHandler(command, 'GalleryCommandDemo$input_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      open: false,
      value: 'invite',
    });
    commandState.open = true;
    clientHandler(command, 'GalleryCommandDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      open: false,
      value: 'invite',
    });

    const contextMenuState = { highlightedValue: 'copy', open: false, value: 'copy' };
    clientHandler(contextMenu, 'GalleryContextMenuDemo$div_contextmenu')(new Event('contextmenu'), {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({ highlightedValue: 'copy', open: true, value: 'copy' });
    const contextKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: ' ',
    });
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_keydown')(contextKeyboardEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextKeyboardEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: false,
      value: 'inspect',
    });

    contextMenuState.open = true;
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: false,
      value: 'inspect',
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
    clientHandler(dialog, 'GalleryDialogDemo$dialog_cancel')(new Event('cancel'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });
    dialogState.open = true;
    clientHandler(dialog, 'GalleryDialogDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });
    dialogState.open = true;
    clientHandler(dialog, 'GalleryDialogDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });

    const dropdownMenuState = { highlightedValue: 'duplicate', open: false, value: 'duplicate' };
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'duplicate',
      open: true,
      value: 'duplicate',
    });
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownMenuState).toEqual({ highlightedValue: 'rename', open: false, value: 'rename' });

    const hoverCardState = { open: false };
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_pointerenter')(new Event('pointerenter'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: true });
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_keydown')(
      Object.assign(new Event('keydown'), { key: 'Escape' }),
      {
        params: {},
        signal,
        state: hoverCardState,
      },
    );
    expect(hoverCardState).toEqual({ open: false });
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_focus')(new Event('focus'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: true });

    const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
    clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarState).toEqual({ activeValue: 'edit', openValue: '', value: 'new' });
    clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarState).toEqual({ activeValue: 'file', openValue: 'file', value: 'new' });
    const menubarKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: ' ',
    });
    clientHandler(menubar, 'GalleryMenubarDemo$button_keydown')(menubarKeyboardEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarKeyboardEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'file', openValue: '', value: 'new' });

    const meterState = { value: 72 };
    clientHandler(meter, 'GalleryMeterDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: meterState,
    });
    expect(meterState).toEqual({ value: 92 });

    const navigationMenuState = { activeValue: 'products', openValue: '', value: 'none' };
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
      new Event('keydown'),
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationMenuState).toEqual({ activeValue: 'docs', openValue: '', value: 'none' });
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: navigationMenuState,
    });
    expect(navigationMenuState).toEqual({
      activeValue: 'docs',
      openValue: 'products',
      value: 'none',
    });

    const numberFieldState = { value: 2 };
    clientHandler(numberField, 'GalleryNumberFieldDemo$input_input')(inputEvent('4'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 4 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 5 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 4 });

    const fieldState = {
      email: 'ada@example',
      invalid: true,
      plan: 'team',
      shippingDisabled: false,
    };
    clientHandler(field, 'GalleryFieldDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'team',
      shippingDisabled: false,
    });
    clientHandler(field, 'GalleryFieldDemo$select_change')(new Event('change'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: false,
    });
    clientHandler(field, 'GalleryFieldDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: true,
    });
    clientHandler(field, 'GalleryFieldDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: false,
    });

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
    clientHandler(popover, 'GalleryPopoverDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: false });

    const progressState: { value: number | null } = { value: 40 };
    clientHandler(progress, 'GalleryProgressDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: progressState,
    });
    expect(progressState).toEqual({ value: 100 });
    clientHandler(progress, 'GalleryProgressDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: progressState,
    });
    expect(progressState).toEqual({ value: null });

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

    const scrollAreaState = { position: 'top' };
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: scrollAreaState,
    });
    expect(scrollAreaState).toEqual({ position: 'end' });

    const selectState = { value: 'standard' };
    clientHandler(select, 'GallerySelectDemo$select_change')(changeEvent('express'), {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectState).toEqual({ value: 'express' });
    const disabledSelectEvent = changeEvent('drone');
    clientHandler(select, 'GallerySelectDemo$select_change')(disabledSelectEvent, {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectState).toEqual({ value: 'express' });
    expect(disabledSelectEvent.defaultPrevented).toBe(true);

    const sliderState = { value: 25 };
    clientHandler(slider, 'GallerySliderDemo$input_input')(inputEvent('63'), {
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

    const tabsState = { activeValue: 'overview', value: 'overview' };
    clientHandler(tabs, 'GalleryTabsDemo$section_keydown')(keyEvent('ArrowRight'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'details', value: 'overview' });
    clientHandler(tabs, 'GalleryTabsDemo$section_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'details', value: 'details' });
    clientHandler(tabs, 'GalleryTabsDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'overview', value: 'overview' });

    const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
    clientHandler(toolbar, 'GalleryToolbarDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'bold' });
    clientHandler(toolbar, 'GalleryToolbarDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'bold', pressedValue: 'bold' });
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

    const toastState = { open: true };
    clientHandler(toast, 'GalleryToastDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({ open: false });
  });

  it('updates browser-observable ARIA, focus, visibility, and output contracts', () => {
    const previousDocument = Reflect.get(globalThis, 'document') as unknown;
    const hadDocument = Reflect.has(globalThis, 'document');
    const signal = new AbortController().signal;

    try {
      const document = fakeDocument({
        ids: [
          'gallery-radio-email',
          'gallery-radio-sms',
          'gallery-checkbox-group-updates',
          'gallery-checkbox-group-billing',
          'gallery-dropdown-menu-trigger',
          'gallery-dropdown-menu-content',
          'gallery-dropdown-menu-rename',
          'gallery-menubar-file',
          'gallery-menubar-edit',
          'gallery-menubar-file-menu',
          'gallery-navigation-products-trigger',
          'gallery-navigation-docs-link',
          'gallery-navigation-products-content',
          'gallery-navigation-viewport',
          'gallery-scroll-area-toggle',
          'gallery-scroll-area-thumb',
          'gallery-scroll-area-viewport',
          'gallery-command-input',
          'gallery-command-listbox-item-1',
          'gallery-command-dialog',
          'gallery-toolbar-bold',
          'gallery-toolbar-link',
          'gallery-toggle-group-bold',
          'gallery-toggle-group-italic',
          'gallery-toast',
        ],
        selectors: [
          '[data-demo-state="radio-value"]',
          '[data-demo-state="checkbox-group-value"]',
          '[data-demo-state="dropdown-open"]',
          '[data-demo-state="dropdown-value"]',
          '[data-demo-state="menubar-active"]',
          '[data-demo-state="menubar-open"]',
          '[data-demo-state="menubar-value"]',
          '[data-demo-state="navigation-open"]',
          '[data-demo-state="navigation-value"]',
          '[data-demo-state="scroll-area-position"]',
          '[data-demo-state="command-input"]',
          '[data-demo-state="command-value"]',
          '[data-demo-state="toolbar-active"]',
          '[data-demo-state="toolbar-pressed"]',
          '[data-demo-state="toggle-group-value"]',
          '[data-demo-state="toast-open"]',
        ],
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: document,
      });

      const radioGroup = evaluateClientModule('radio-group-demo.client.js', { document });
      const radioState = { value: 'email' };
      clientHandler(radioGroup, 'GalleryRadioGroupDemo$section_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: radioState,
      });
      expect(radioState).toEqual({ value: 'sms' });
      expect(element(document, 'gallery-radio-email')).toMatchObject({
        checked: false,
        tabIndex: -1,
      });
      expect(element(document, 'gallery-radio-email').attrs['aria-checked']).toBe('false');
      expect(element(document, 'gallery-radio-sms')).toMatchObject({ checked: true, tabIndex: 0 });
      expect(selector(document, '[data-demo-state="radio-value"]').textContent).toBe('sms');

      const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js', { document });
      const checkboxState = { activeValue: 'updates', value: 'updates' };
      clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$input_click_2')(new Event('click'), {
        params: {},
        signal,
        state: checkboxState,
      });
      expect(checkboxState).toEqual({ activeValue: 'updates', value: 'updates,billing' });
      expect(element(document, 'gallery-checkbox-group-billing')).toMatchObject({
        checked: true,
      });
      expect(element(document, 'gallery-checkbox-group-billing').attrs).toMatchObject({
        'aria-checked': 'true',
        'data-state': 'checked',
      });
      expect(selector(document, '[data-demo-state="checkbox-group-value"]').textContent).toBe(
        'updates,billing',
      );

      const dropdownMenu = evaluateClientModule('dropdown-menu-demo.client.js', { document });
      const dropdownState = { highlightedValue: 'duplicate', open: false, value: 'duplicate' };
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(element(document, 'gallery-dropdown-menu-trigger').attrs['aria-expanded']).toBe(
        'true',
      );
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="dropdown-open"]').textContent).toBe('open');
      const dropdownKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Enter',
      });
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown')(dropdownKeyboardEvent, {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(dropdownKeyboardEvent.defaultPrevented).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-rename').attrs['data-highlighted']).toBe('');
      expect(selector(document, '[data-demo-state="dropdown-value"]').textContent).toBe('rename');

      dropdownState.open = true;
      element(document, 'gallery-dropdown-menu-content').hidden = false;
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click_3')(new Event('click'), {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-rename').attrs['data-highlighted']).toBe('');
      expect(selector(document, '[data-demo-state="dropdown-value"]').textContent).toBe('rename');

      const menubar = evaluateClientModule('menubar-demo.client.js', { document });
      const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
      clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: menubarState,
      });
      expect(element(document, 'gallery-menubar-file').tabIndex).toBe(-1);
      expect(element(document, 'gallery-menubar-edit').tabIndex).toBe(0);
      expect(selector(document, '[data-demo-state="menubar-active"]').textContent).toBe('edit');
      clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: menubarState,
      });
      expect(element(document, 'gallery-menubar-file').attrs['aria-expanded']).toBe('true');
      expect(element(document, 'gallery-menubar-file-menu').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="menubar-open"]').textContent).toBe('file');
      const menubarKeyEvent = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Enter',
      });
      clientHandler(menubar, 'GalleryMenubarDemo$button_keydown')(menubarKeyEvent, {
        params: {},
        signal,
        state: menubarState,
      });
      expect(menubarKeyEvent.defaultPrevented).toBe(true);
      expect(element(document, 'gallery-menubar-file').attrs['aria-expanded']).toBe('false');
      expect(element(document, 'gallery-menubar-file-menu').hidden).toBe(true);
      expect(selector(document, '[data-demo-state="menubar-open"]').textContent).toBe('none');
      expect(selector(document, '[data-demo-state="menubar-value"]').textContent).toBe('new');

      const navigationMenu = evaluateClientModule('navigation-menu-demo.client.js', { document });
      const navigationState = { activeValue: 'products', openValue: '', value: 'none' };
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
        new Event('keydown'),
        { params: {}, signal, state: navigationState },
      );
      expect(element(document, 'gallery-navigation-products-trigger').tabIndex).toBe(-1);
      expect(element(document, 'gallery-navigation-docs-link').tabIndex).toBe(0);
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: navigationState,
      });
      expect(element(document, 'gallery-navigation-products-trigger').attrs['aria-expanded']).toBe(
        'true',
      );
      expect(element(document, 'gallery-navigation-products-content').hidden).toBe(false);
      expect(element(document, 'gallery-navigation-viewport').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="navigation-open"]').textContent).toBe(
        'products',
      );
      const navClick = new Event('click', { cancelable: true });
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$a_click')(navClick, {
        params: {},
        signal,
        state: navigationState,
      });
      expect(navClick.defaultPrevented).toBe(true);
      expect(selector(document, '[data-demo-state="navigation-value"]').textContent).toBe('docs');

      const scrollArea = evaluateClientModule('scroll-area-demo.client.js', { document });
      const scrollAreaState = { position: 'top' };
      clientHandler(scrollArea, 'GalleryScrollAreaDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: scrollAreaState,
      });
      expect(scrollAreaState).toEqual({ position: 'end' });
      expect(element(document, 'gallery-scroll-area-viewport')).toMatchObject({
        scrollTop: 160,
      });
      expect(element(document, 'gallery-scroll-area-viewport').attrs['data-scroll-position']).toBe(
        'end',
      );
      expect(element(document, 'gallery-scroll-area-thumb').attrs['data-scroll-position']).toBe(
        'end',
      );
      expect(element(document, 'gallery-scroll-area-toggle').attrs['aria-pressed']).toBe('true');
      expect(selector(document, '[data-demo-state="scroll-area-position"]').textContent).toBe(
        'end',
      );

      const command = evaluateClientModule('command-demo.client.js', { document });
      const commandState = {
        highlightedValue: 'dashboard',
        inputValue: '',
        open: false,
        value: 'dashboard',
      };
      clientHandler(command, 'GalleryCommandDemo$input_input')(new Event('input'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(element(document, 'gallery-command-input')).toMatchObject({ value: 'invite' });
      expect(element(document, 'gallery-command-input').attrs['aria-activedescendant']).toBe(
        'gallery-command-listbox-item-1',
      );
      expect(element(document, 'gallery-command-listbox-item-1').attrs['aria-selected']).toBe(
        'true',
      );
      expect(selector(document, '[data-demo-state="command-input"]').textContent).toBe('invite');
      clientHandler(command, 'GalleryCommandDemo$input_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(element(document, 'gallery-command-dialog').closeCalls).toBe(1);
      expect(selector(document, '[data-demo-state="command-value"]').textContent).toBe(
        'Invite teammate',
      );
      commandState.open = true;
      clientHandler(command, 'GalleryCommandDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(element(document, 'gallery-command-dialog').closeCalls).toBe(2);
      expect(selector(document, '[data-demo-state="command-value"]').textContent).toBe(
        'Invite teammate',
      );

      const toolbar = evaluateClientModule('toolbar-demo.client.js', { document });
      const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
      clientHandler(toolbar, 'GalleryToolbarDemo$section_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(element(document, 'gallery-toolbar-bold').tabIndex).toBe(-1);
      expect(element(document, 'gallery-toolbar-link').tabIndex).toBe(0);
      expect(element(document, 'gallery-toolbar-link').focusCalls).toBe(1);
      expect(selector(document, '[data-demo-state="toolbar-active"]').textContent).toBe('link');
      clientHandler(toolbar, 'GalleryToolbarDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(element(document, 'gallery-toolbar-link').attrs['aria-pressed']).toBe('true');
      expect(selector(document, '[data-demo-state="toolbar-pressed"]').textContent).toBe('link');

      const toggleGroup = evaluateClientModule('toggle-group-demo.client.js', { document });
      const toggleGroupState = { activeValue: 'bold', value: 'bold' };
      clientHandler(toggleGroup, 'GalleryToggleGroupDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toggleGroupState,
      });
      expect(element(document, 'gallery-toggle-group-bold').attrs).toMatchObject({
        'aria-pressed': 'true',
        'data-state': 'pressed',
      });
      expect(element(document, 'gallery-toggle-group-italic').attrs).toMatchObject({
        'aria-pressed': 'true',
        'data-state': 'pressed',
      });
      expect(selector(document, '[data-demo-state="toggle-group-value"]').textContent).toBe(
        'bold,italic',
      );

      const toast = evaluateClientModule('toast-demo.client.js', { document });
      const toastState = { open: true };
      clientHandler(toast, 'GalleryToastDemo$section_keydown')(
        Object.assign(new Event('keydown'), { key: 'Enter' }),
        { params: {}, signal, state: toastState },
      );
      expect(toastState).toEqual({ open: true });
      clientHandler(toast, 'GalleryToastDemo$section_keydown')(
        Object.assign(new Event('keydown'), { key: 'Escape' }),
        { params: {}, signal, state: toastState },
      );
      expect(element(document, 'gallery-toast').hidden).toBe(true);
      expect(element(document, 'gallery-toast').attrs['data-state']).toBe('closed');
      expect(selector(document, '[data-demo-state="toast-open"]').textContent).toBe('closed');
    } finally {
      if (hadDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });
});

function readGenerated(fileName: string): string {
  return readFileSync(resolve(galleryRoot, `src/generated/interactive/${fileName}`), 'utf8');
}

function generatedInteractiveDemoNames(): string[] {
  return readdirSync(resolve(galleryRoot, 'src/generated/interactive'))
    .filter((fileName) => fileName.endsWith('-demo.tsx'))
    .map((fileName) => fileName.replace(/\.tsx$/, ''))
    .sort(compareStrings);
}

function extractClientExports(source: string): string[] {
  return [...source.matchAll(/export const ([A-Za-z0-9_$]+) = handler/g)]
    .map((match) => match[1] ?? '')
    .sort(compareStrings);
}

function extractGeneratedClientRefs(
  html: string,
): Array<{ eventName: string; exportName: string; modulePath: string; version: string }> {
  return [...html.matchAll(/on:([a-z]+)="([^"]+)"/g)].map((match) => {
    const eventName = match[1] ?? '';
    const ref = match[2] ?? '';
    const parsed = ref.match(/^([^?#"]+)\?v=([0-9a-f]{8})#([A-Za-z0-9_$]+)$/);
    if (parsed === null) throw new Error(`Unexpected generated client ref: ${ref}`);

    return {
      eventName,
      exportName: parsed[3] ?? '',
      modulePath: parsed[1] ?? '',
      version: parsed[2] ?? '',
    };
  });
}

function pascalCase(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function evaluateClientModule(
  fileName: string,
  globals: Record<string, unknown> = {},
): ClientExports {
  const source = readGenerated(fileName)
    .replace("import { handler } from '@jiso/runtime';\n\n", '')
    .replaceAll('export const ', 'exports.');
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    exports,
    handler: (fn: ClientExports[string]) => fn,
    ...globals,
  });

  return exports;
}

function clientHandler(exports: ClientExports, name: string): ClientExports[string] {
  const fn = exports[name];
  if (fn === undefined) throw new Error(`Missing generated handler export: ${name}`);

  return fn;
}

function inputEvent(value: string): Event {
  const event = new Event('input', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: { value } });
  return event;
}

function changeEvent(value: string): Event {
  const event = new Event('change', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: { value } });
  return event;
}

function keyEvent(key: string): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

function fakeDocument(options: {
  ids: readonly string[];
  selectors: readonly string[];
}): FakeDocument {
  const byId = new Map(options.ids.map((id) => [id, fakeElement()]));
  const bySelector = new Map(options.selectors.map((selector) => [selector, fakeElement()]));

  return {
    byId,
    bySelector,
    getElementById: (id) => byId.get(id),
    querySelector: (selector) => bySelector.get(selector),
  };
}

function fakeElement(): FakeElement {
  const element: FakeElement = {
    attrs: {},
    closeCalls: 0,
    focusCalls: 0,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  element.close = () => {
    element.closeCalls += 1;
  };
  element.focus = () => {
    element.focusCalls += 1;
  };

  return element;
}

function element(document: FakeDocument, id: string): FakeElement {
  const value = document.byId.get(id);
  if (value === undefined) throw new Error(`Missing fake element: ${id}`);

  return value;
}

function selector(document: FakeDocument, query: string): FakeElement {
  const value = document.bySelector.get(query);
  if (value === undefined) throw new Error(`Missing fake selector: ${query}`);

  return value;
}
