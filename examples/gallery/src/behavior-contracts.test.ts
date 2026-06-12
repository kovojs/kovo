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
  '/components/dialog': {
    changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle, programmatic',
    dataState: 'open, closed',
    keyboard: 'Escape closes the native dialog',
  },
  '/components/field': {
    changeReasons: 'native form control changes',
    dataState: 'invalid, required, disabled',
    keyboard: 'Native field and fieldset semantics',
  },
  '/components/kbd': {
    changeReasons: 'not stateful',
    dataState: 'not emitted',
    keyboard: 'No custom keyboard handling',
  },
  '/components/meter': {
    changeReasons: 'value comes from app state',
    dataState: 'optimum, suboptimum, even-less-good',
    keyboard: 'No custom keyboard handling',
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
    keyboard: 'Arrow keys move focus; activation mode controls selection',
  },
  '/components/toggle': {
    changeReasons: 'trigger-click, programmatic',
    dataState: 'pressed, off, disabled',
    keyboard: 'Space or Enter activates the native button',
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
  '/components/dialog': [
    'command="show-modal"',
    'commandfor="gallery-dialog-content"',
    'aria-labelledby="gallery-dialog-title"',
    'aria-describedby="gallery-dialog-description"',
    'open',
  ],
  '/components/field': [
    'for="gallery-field-email"',
    'aria-describedby="gallery-field-description gallery-field-error"',
    'aria-invalid="true"',
    'role="alert"',
  ],
  '/components/kbd': ['<kbd class="inline-flex h-5 min-w-5', 'uppercase">K</kbd>'],
  '/components/meter': [
    '<meter',
    'data-low="50"',
    'data-high="90"',
    'data-state="optimum"',
    'data-state="suboptimum"',
  ],
  '/components/number-field': [
    'type="number"',
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
    'readOnly',
    'tabIndex="-1"',
    'data-slot="0"',
    'maxLength="1"',
    'data-filled',
    'data-complete',
    'data-disabled',
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
    'disabled tabIndex="-1"',
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
    'selected',
    'disabled',
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
    'disabled role="tab" tabIndex="-1"',
  ],
  '/components/toggle': [
    'data-state="pressed"',
    'aria-pressed="true"',
    'data-state="off"',
    'disabled',
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
