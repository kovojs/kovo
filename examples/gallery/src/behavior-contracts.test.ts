import { describe, expect, it } from 'vitest';

import { galleryFixtures, type GalleryRoute } from './demo-fixtures.js';

interface ExpectedBehaviorContract {
  changeReasons: string;
  dataState: string;
  keyboard: string;
}

const expectedBehaviorContracts = {
  '/components/accordion': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Native button activation opens an item; group keyboard maps are primitive-owned',
  },
  '/components/alert': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/alert-dialog': {
    changeReasons:
      'trigger-click, cancel-click, action-click, cancel-event, native-beforetoggle, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Escape cancels the native alert dialog',
  },
  '/components/autocomplete': {
    changeReasons: 'input, option-select, typeahead, programmatic',
    dataState: 'open, closed, checked, unchecked, highlighted, disabled',
    keyboard: 'Arrow keys open and move over enabled suggestions; Escape closes suggestions',
  },
  '/components/avatar': {
    changeReasons: 'image-load, image-error, programmatic',
    dataState: 'loading, loaded, error',
    keyboard: 'No custom keyboard handling',
  },
  '/components/badge': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/breadcrumb': {
    changeReasons: 'native link navigation',
    dataState: 'not emitted',
    keyboard: 'Native link keyboard behavior',
  },
  '/components/button': {
    changeReasons: 'native click or form submit',
    dataState: 'disabled via native attribute',
    keyboard: 'Space or Enter activates the native button',
  },
  '/components/card': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/checkbox': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'checked, unchecked, indeterminate, disabled',
    keyboard: 'Space toggles the native checkbox',
  },
  '/components/checkbox-group': {
    changeReasons: 'item-click, keyboard, programmatic',
    dataState: 'checked, unchecked, disabled',
    keyboard: 'Arrow keys move focus over enabled checkbox items; Space toggles focused item',
  },
  '/components/collapsible': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Native summary toggles the details element',
  },
  '/components/combobox': {
    changeReasons: 'input, option-select, arrow-key, escape-key, typeahead, programmatic',
    dataState: 'open, closed, checked, unchecked, highlighted, disabled',
    keyboard: 'Arrow keys open and move over enabled options; Escape closes the listbox',
  },
  '/components/command': {
    changeReasons:
      'trigger-click, input, item-click, enter-key, escape-key, close-click, cancel-event, native-beforetoggle, programmatic',
    dataState: 'open, closed, active, inactive, highlighted, disabled',
    keyboard: 'Arrow keys move command options; Enter selects; Escape closes the dialog',
  },
  '/components/context-menu': {
    changeReasons:
      'trigger-context-menu, keyboard-open, item-click, item-keyboard, escape-key, programmatic',
    dataState: 'open, closed, highlighted, disabled',
    keyboard: 'Context menu key or Shift+F10 opens; Arrow keys move; Enter or Space selects items',
  },
  '/components/dialog': {
    changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle, programmatic',
    dataState: 'open, closed',
    keyboard: 'Escape closes the native dialog',
  },
  '/components/disclosure': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Space or Enter activates the disclosure button',
  },
  '/components/drawer': {
    changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
    dataState: 'open, closed, disabled',
    keyboard: 'Escape closes the native dialog',
  },
  '/components/dropdown-menu': {
    changeReasons:
      'trigger-click, arrow-key, item-click, item-keyboard, escape-key, typeahead, programmatic',
    dataState: 'open, closed, highlighted, disabled',
    keyboard: 'Arrow keys open and move; Enter or Space selects items; Escape closes the menu',
  },
  '/components/field': {
    changeReasons: 'native form control changes',
    dataState: 'invalid, required, disabled',
    keyboard: 'Native field and fieldset semantics',
  },
  '/components/hover-card': {
    changeReasons:
      'trigger-pointer-enter, trigger-pointer-leave, trigger-focus, trigger-blur, content-pointer-enter, content-pointer-leave, content-focus, content-blur, escape-key, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Focus opens the hover card; Escape closes it',
  },
  '/components/kbd': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/menubar': {
    changeReasons:
      'item-click, item-keyboard, item-pointer-enter, item-select, escape-key, programmatic',
    dataState: 'open, closed, highlighted, disabled, orientation',
    keyboard: 'Arrow keys move across top-level items and nested menus',
  },
  '/components/meter': {
    changeReasons: 'value comes from app state',
    dataState: 'optimum, suboptimum, even-less-good',
    keyboard: 'No custom keyboard handling',
  },
  '/components/navigation-menu': {
    changeReasons:
      'trigger-click, trigger-focus, trigger-keyboard, trigger-pointer-enter, link-click, escape-key, programmatic',
    dataState: 'open, closed, highlighted, disabled, orientation',
    keyboard: 'Arrow keys move across navigation items; Enter or Space opens trigger content',
  },
  '/components/number-field': {
    changeReasons: 'input, increment, decrement, programmatic',
    dataState: 'invalid, required, disabled',
    keyboard: 'Native number input keyboard plus primitive step buttons',
  },
  '/components/otp-field': {
    changeReasons: 'input, delete, paste, programmatic',
    dataState: 'invalid, required, complete, disabled',
    keyboard: 'Arrow keys, Home, and End move between visible slots',
  },
  '/components/popover': {
    changeReasons: 'trigger-click, escape-key, native-beforetoggle, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Native popover trigger toggles content; Escape closes the popover',
  },
  '/components/progress': {
    changeReasons: 'value comes from app state',
    dataState: 'loading, complete, indeterminate',
    keyboard: 'No custom keyboard handling',
  },
  '/components/radio-group': {
    changeReasons: 'item-click, keyboard, programmatic',
    dataState: 'checked, unchecked, disabled',
    keyboard: 'Arrow keys move over enabled radio items',
  },
  '/components/scroll-area': {
    changeReasons: 'native scroll position changes',
    dataState: 'visible, hidden, disabled',
    keyboard: 'Native viewport scrolling and focus behavior',
  },
  '/components/select': {
    changeReasons: 'trigger-change, programmatic',
    dataState: 'open, closed, checked, unchecked, disabled',
    keyboard: 'Native select keyboard behavior',
  },
  '/components/separator': {
    changeReasons: 'not stateful',
    dataState: 'orientation only',
    keyboard: 'No custom keyboard handling',
  },
  '/components/sheet': {
    changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
    dataState: 'open, closed, disabled',
    keyboard: 'Escape closes the native dialog',
  },
  '/components/skeleton': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/slider': {
    changeReasons: 'input, programmatic',
    dataState: 'horizontal, vertical, invalid, required, disabled',
    keyboard: 'Native range input keyboard behavior',
  },
  '/components/switch': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'checked, unchecked, disabled',
    keyboard: 'Space toggles the native checkbox',
  },
  '/components/table': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'Native table navigation semantics',
  },
  '/components/tabs': {
    changeReasons: 'trigger-click, keyboard, programmatic',
    dataState: 'active, inactive, disabled',
    keyboard: 'Arrow keys move focus; Enter or Space activates the focused tab in manual mode',
  },
  '/components/toast': {
    changeReasons: 'action-click, close-click, escape-key, timeout, programmatic',
    dataState: 'open, closed, disabled, variant',
    keyboard: 'Escape dismisses the active toast',
  },
  '/components/toggle': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'pressed, off, disabled',
    keyboard: 'Space or Enter activates the native button',
  },
  '/components/toggle-group': {
    changeReasons: 'item-click, keyboard, programmatic',
    dataState: 'pressed, off, disabled',
    keyboard: 'Arrow keys move focus over enabled toggle buttons',
  },
  '/components/toolbar': {
    changeReasons: 'button-click, keyboard, programmatic',
    dataState: 'pressed, unpressed, disabled',
    keyboard: 'Arrow keys move focus over enabled toolbar buttons',
  },
  '/components/tooltip': {
    changeReasons:
      'trigger-pointer-enter, trigger-pointer-leave, trigger-focus, trigger-blur, escape-key, programmatic',
    dataState: 'open, closed, disabled',
    keyboard: 'Escape closes an open tooltip',
  },
} as const satisfies Record<GalleryRoute['path'], ExpectedBehaviorContract>;

const expectedBehaviorSnippets: Partial<Record<GalleryRoute['path'], readonly string[]>> = {
  '/components/accordion': [
    'aria-expanded="true"',
    'aria-controls="gallery-accordion-shipping-panel"',
    'aria-labelledby="gallery-accordion-shipping-trigger"',
    'hidden id="gallery-accordion-billing-panel"',
  ],
  '/components/avatar': [
    'role="img"',
    'aria-label="Ada Lovelace avatar"',
    '<img alt="Ada Lovelace"',
    'decoding="async"',
    'data-delay="250"',
    'hidden>GH</span>',
    'hidden src="/avatars/missing.png"',
  ],
  '/components/alert': [
    'role="status"',
    'role="alert"',
    'border-emerald-200 bg-emerald-50',
    'border-red-200 bg-red-50',
  ],
  '/components/alert-dialog': [
    'command="show-modal"',
    'commandfor="gallery-alert-dialog-content"',
    'role="alertdialog"',
    'aria-modal="true"',
    'aria-labelledby="gallery-alert-dialog-title"',
    'aria-describedby="gallery-alert-dialog-description"',
    'autofocus',
    'data-intent="cancel"',
    'data-intent="destructive"',
    'command="request-close"',
  ],
  '/components/autocomplete': [
    'role="combobox"',
    'aria-autocomplete="list"',
    'aria-controls="gallery-autocomplete-list"',
    'aria-activedescendant="gallery-autocomplete-list-option-1"',
    'list="gallery-autocomplete-list"',
    '<datalist',
    'data-highlighted="" data-state="checked"',
    'id="gallery-autocomplete-value">Growth plan</span>',
  ],
  '/components/breadcrumb': [
    'aria-label="Account path"',
    'href="/account"',
    'aria-current="page"',
    'data-orientation="horizontal" role="none"',
  ],
  '/components/button': ['type="button"', 'disabled type="button"'],
  '/components/checkbox': [
    'type="checkbox"',
    'required',
    'aria-checked="mixed"',
    'data-state="indeterminate"',
    'disabled',
  ],
  '/components/checkbox-group': [
    'role="group"',
    'aria-labelledby="gallery-checkbox-group-label"',
    'aria-describedby="gallery-checkbox-group-description gallery-checkbox-group-error"',
    'aria-invalid="true"',
    'aria-required="true"',
    'type="checkbox"',
    'name="gallery-notifications"',
    'aria-checked="true"',
    'tabIndex="0"',
    'data-disabled="" data-state="unchecked" disabled',
    'tabIndex="-1" type="checkbox" value="security"',
  ],
  '/components/collapsible': [
    '<details',
    'open>',
    '<summary',
    'aria-expanded="true"',
    'aria-controls="gallery-collapsible-content"',
    'data-disabled="" data-state="closed"',
  ],
  '/components/combobox': [
    'role="combobox"',
    'aria-autocomplete="list"',
    'aria-controls="gallery-combobox-listbox"',
    'aria-activedescendant="gallery-combobox-listbox-option-1"',
    'role="listbox"',
    'aria-selected="true"',
    'data-highlighted="" data-state="unchecked"',
    'aria-disabled="true"',
    'id="gallery-combobox-value">Ada Lovelace</span>',
  ],
  '/components/command': [
    'command="show-modal"',
    'commandfor="gallery-command-dialog"',
    'aria-modal="true"',
    'role="combobox"',
    'aria-activedescendant="gallery-command-listbox-item-1"',
    'role="listbox"',
    'aria-selected="true"',
    'data-highlighted="" data-state="active"',
    'command="request-close"',
    'id="gallery-command-value">Invite teammate</span>',
  ],
  '/components/context-menu': [
    'jiso-context-menu="gallery-context-menu-content"',
    'aria-haspopup="menu"',
    'data-anchor-x="24"',
    'data-anchor-y="32"',
    'role="menu"',
    'id="gallery-context-menu-inspect"',
    'data-highlighted="" data-state="active"',
  ],
  '/components/dialog': [
    'command="show-modal"',
    'commandfor="gallery-dialog-content"',
    'aria-labelledby="gallery-dialog-title"',
    'aria-describedby="gallery-dialog-description"',
    'open',
  ],
  '/components/disclosure': [
    'aria-expanded="true"',
    'aria-controls="gallery-disclosure-content"',
    'id="gallery-disclosure-content"',
  ],
  '/components/drawer': [
    'command="show-modal" commandfor="gallery-drawer"',
    '<dialog aria-describedby="gallery-drawer-description"',
    'id="gallery-drawer" open>',
    'bottom-0 max-h-[85vh] border-t',
    'command="request-close" commandfor="gallery-drawer"',
  ],
  '/components/dropdown-menu': [
    'aria-controls="gallery-dropdown-menu-content"',
    'aria-expanded="true"',
    'aria-haspopup="menu"',
    'role="menu"',
    'id="gallery-dropdown-menu-rename"',
    'tabIndex="0" type="button" value="rename"',
  ],
  '/components/field': [
    'for="gallery-field-email"',
    'aria-describedby="gallery-field-description gallery-field-error"',
    'aria-invalid="true"',
    'form="gallery-field-external-form"',
    'autoComplete="email"',
    'inputMode="email"',
    'maxLength="80"',
    'minLength="3"',
    'pattern=".+@example\\.com"',
    '<textarea aria-describedby="gallery-field-bio-description"',
    'autoComplete="off"',
    'maxLength="240"',
    '<select aria-describedby="gallery-field-plan-description"',
    '<option value="team" selected>Team</option>',
    'disabled form="gallery-field-external-form" id="gallery-fieldset"',
    'name="seat-options"',
    'for="gallery-fieldset-seat"',
    'id="gallery-fieldset-seat" name="seat"',
    'role="alert"',
  ],
  '/components/hover-card': [
    'href="/team/ada"',
    'jiso-hover-card="gallery-hover-card-content"',
    'aria-controls="gallery-hover-card-content"',
    'popover="manual"',
    'id="gallery-hover-card-content"',
  ],
  '/components/kbd': ['<kbd class="inline-flex h-5 min-w-5', 'uppercase">K</kbd>'],
  '/components/menubar': [
    'aria-label="Document commands"',
    'role="menubar"',
    'aria-controls="gallery-menubar-file-menu"',
    'aria-expanded="true"',
    'role="menu"',
    'id="gallery-menubar-import"',
    'aria-disabled="true"',
  ],
  '/components/meter': [
    '<meter',
    'data-low="50"',
    'data-high="90"',
    'data-state="optimum"',
    'data-state="suboptimum"',
  ],
  '/components/navigation-menu': [
    'aria-label="Primary navigation"',
    'role="navigation"',
    'role="list"',
    'role="listitem"',
    'aria-controls="gallery-navigation-products-panel"',
    'aria-expanded="true"',
    'href="/docs"',
    'id="gallery-navigation-viewport"',
  ],
  '/components/number-field': [
    'type="number"',
    'form="gallery-number-field-form"',
    'name="gallery-quantity"',
    'aria-describedby="gallery-number-field-description gallery-number-field-error"',
    'aria-invalid="true"',
    'aria-controls="gallery-number-field-input"',
    'data-action="decrement"',
    'data-action="increment"',
    'disabled type="button"',
  ],
  '/components/otp-field': [
    'role="group"',
    'aria-describedby="gallery-otp-description gallery-otp-error"',
    'aria-invalid="true"',
    'aria-required="true"',
    'data-slot="hidden-input"',
    'autoComplete="one-time-code"',
    'name="gallery-otp-code"',
    'maxLength="6"',
    'minLength="6"',
    'tabIndex="-1"',
    'data-slot="0"',
    'maxLength="1"',
    'data-filled',
    'data-complete',
    'data-disabled',
  ],
  '/components/popover': [
    'popovertarget="gallery-popover-content"',
    'popovertargetaction="toggle"',
    'aria-controls="gallery-popover-content"',
    'popover="auto"',
    'id="gallery-popover-content"',
  ],
  '/components/progress': [
    '<progress',
    'data-state="loading"',
    'data-state="complete"',
    'data-state="indeterminate"',
  ],
  '/components/radio-group': [
    'role="radiogroup"',
    'type="radio"',
    'aria-checked="true"',
    'tabIndex="0"',
    'disabled id="gallery-radio-freight"',
    'tabIndex="-1" type="radio" value="freight"',
  ],
  '/components/scroll-area': [
    'role="region"',
    'aria-labelledby="gallery-scroll-area-title"',
    'aria-describedby="gallery-scroll-area-description"',
    'tabIndex="0"',
    'aria-hidden="true"',
    'data-orientation="vertical"',
    'data-orientation="horizontal"',
    'data-state="visible"',
    'data-state="hidden"',
    'aria-disabled="true"',
    'tabIndex="-1"',
  ],
  '/components/select': [
    '<select',
    'aria-labelledby="gallery-select-label"',
    '<optgroup',
    'selected',
    'disabled',
    'id="gallery-select-value">Growth</span>',
  ],
  '/components/separator': ['role="none"', 'role="separator"', 'aria-orientation="vertical"'],
  '/components/sheet': [
    'command="show-modal" commandfor="gallery-sheet"',
    '<dialog aria-describedby="gallery-sheet-description"',
    'id="gallery-sheet" open>',
    'command="request-close" commandfor="gallery-sheet"',
  ],
  '/components/skeleton': [
    'aria-hidden="true"',
    'animate-pulse rounded-md bg-neutral-200 h-4 w-40',
  ],
  '/components/slider': [
    'type="range"',
    'name="gallery-coverage"',
    'aria-describedby="gallery-slider-description gallery-slider-error"',
    'aria-valuetext="65 percent coverage"',
    'data-part="track"',
    'data-part="range"',
    'data-part="thumb"',
    'data-value-ratio="0.65"',
  ],
  '/components/switch': ['role="switch"', 'type="checkbox"', 'aria-checked="true"', 'disabled'],
  '/components/table': [
    '<table class="w-full caption-bottom border-collapse text-sm">',
    '<caption class="mt-3 text-sm text-neutral-500">',
    '<thead class="border-b border-neutral-200 bg-neutral-50">',
    'scope="row">INV-0042</th>',
    'colspan="3"',
  ],
  '/components/tabs': [
    'role="tablist"',
    'role="tab"',
    'aria-selected="true"',
    'aria-controls="gallery-tabs-overview-panel"',
    'role="tabpanel"',
    'data-disabled="" data-state="inactive" disabled',
    'role="tab" tabIndex="-1" type="button" value="audit"',
  ],
  '/components/toast': [
    'role="region"',
    'aria-live="polite"',
    'aria-labelledby="gallery-toast-title"',
    'aria-describedby="gallery-toast-description"',
    'data-state="open" data-variant="success"',
    'role="status"',
    'data-action=""',
    'data-dismiss=""',
    'data-state="closed" data-variant="error" hidden',
    'role="alert"',
  ],
  '/components/toggle': [
    'data-state="pressed"',
    'aria-pressed="true"',
    'data-state="off"',
    'disabled',
  ],
  '/components/toggle-group': [
    'role="group"',
    'aria-labelledby="gallery-toggle-group-label"',
    'aria-describedby="gallery-toggle-group-description"',
    'data-state="pressed"',
    'aria-pressed="true"',
    'tabIndex="0" type="button" value="bold"',
    'data-disabled="" data-state="off" disabled',
    'tabIndex="-1" type="button" value="strike"',
  ],
  '/components/toolbar': [
    'role="toolbar"',
    'aria-labelledby="gallery-toolbar-label"',
    'aria-describedby="gallery-toolbar-description"',
    'aria-pressed="true"',
    'data-pressed="true"',
    'tabIndex="0" type="button" value="bold"',
    'data-disabled="" data-pressed="false" disabled',
    'tabIndex="-1" type="button" value="link"',
  ],
  '/components/tooltip': [
    'jiso-tooltip="gallery-tooltip-content"',
    'aria-describedby="gallery-tooltip-content"',
    'popover="manual"',
    'role="tooltip"',
  ],
};

describe('gallery behavior-contract gates', () => {
  it('pins every rendered route to an exact browser-free behavior contract', () => {
    for (const fixture of galleryFixtures()) {
      expect(extractBehaviorContract(fixture.html), fixture.path).toEqual(
        expectedBehaviorContracts[fixture.path],
      );
    }
  });

  it('pins represented primitive routes to required native and ARIA behavior snippets', () => {
    for (const fixture of galleryFixtures()) {
      const snippets = expectedBehaviorSnippets[fixture.path] ?? [];

      for (const snippet of snippets) {
        expect(fixture.html, `${fixture.path} should include ${snippet}`).toContain(snippet);
      }
    }
  });
});

function extractBehaviorContract(html: string): ExpectedBehaviorContract {
  const table = html.match(/<table data-gallery-contract>([\s\S]*?)<\/table>/)?.[1];

  if (!table) {
    throw new Error('Missing gallery behavior-contract table');
  }

  const rows = new Map<string, string>();
  const rowPattern = /<tr>\s*<th scope="row">([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
  for (const match of table.matchAll(rowPattern)) {
    const [, label, value] = match;
    if (label && value) rows.set(label, value);
  }

  return {
    changeReasons: requireContractRow(rows, 'change reasons'),
    dataState: requireContractRow(rows, 'data-state'),
    keyboard: requireContractRow(rows, 'keyboard'),
  };
}

function requireContractRow(rows: ReadonlyMap<string, string>, label: string): string {
  const value = rows.get(label);

  if (value === undefined) {
    throw new Error(`Missing gallery behavior-contract row: ${label}`);
  }

  return value;
}
