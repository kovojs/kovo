/** @jsxImportSource @kovojs/server */
import { GalleryAccordionDemo } from './interactive/accordion-demo.js';
import { GalleryAlertDialogDemo } from './interactive/alert-dialog-demo.js';
import { GalleryAutocompleteDemo } from './interactive/autocomplete-demo.js';
import { GalleryCheckboxDemo } from './interactive/checkbox-demo.js';
import { GalleryCheckboxGroupDemo } from './interactive/checkbox-group-demo.js';
import { GalleryCollapsibleDemo } from './interactive/collapsible-demo.js';
import { GalleryComboboxDemo } from './interactive/combobox-demo.js';
import { GalleryCommandDemo } from './interactive/command-demo.js';
import { GalleryContextMenuDemo } from './interactive/context-menu-demo.js';
import { GalleryDialogDemo } from './interactive/dialog-demo.js';
import { GalleryDrawerDemo } from './interactive/drawer-demo.js';
import { GalleryDisclosureDemo } from './interactive/disclosure-demo.js';
import { GalleryDropdownMenuDemo } from './interactive/dropdown-menu-demo.js';
import { GalleryFieldDemo } from './interactive/field-demo.js';
import { GalleryHoverCardDemo } from './interactive/hover-card-demo.js';
import { GalleryMenubarDemo } from './interactive/menubar-demo.js';
import { GalleryMeterDemo } from './interactive/meter-demo.js';
import { GalleryNavigationMenuDemo } from './interactive/navigation-menu-demo.js';
import { GalleryNumberFieldDemo } from './interactive/number-field-demo.js';
import { GalleryOtpFieldDemo } from './interactive/otp-field-demo.js';
import { GalleryPopoverDemo } from './interactive/popover-demo.js';
import { GalleryProgressDemo } from './interactive/progress-demo.js';
import { GalleryPureMarkupDemo } from './interactive/pure-markup-demo.js';
import { GalleryRadioGroupDemo } from './interactive/radio-group-demo.js';
import { GalleryScrollAreaDemo } from './interactive/scroll-area-demo.js';
import { GallerySelectDemo } from './interactive/select-demo.js';
import { GallerySheetDemo } from './interactive/sheet-demo.js';
import { GallerySliderDemo } from './interactive/slider-demo.js';
import { GallerySwitchDemo } from './interactive/switch-demo.js';
import { GalleryTabsDemo } from './interactive/tabs-demo.js';
import { GalleryToastDemo } from './interactive/toast-demo.js';
import { GalleryToggleDemo } from './interactive/toggle-demo.js';
import { GalleryToggleGroupDemo } from './interactive/toggle-group-demo.js';
import { GalleryToolbarDemo } from './interactive/toolbar-demo.js';
import { GalleryTooltipDemo } from './interactive/tooltip-demo.js';

export interface InteractiveGalleryDemo {
  name: string;
  render: () => Promise<string>;
  title: string;
}

export const interactiveGalleryDemos = Object.freeze([
  {
    name: 'accordion-demo',
    render: renderInteractiveDemo(GalleryAccordionDemo),
    title: 'Accordion',
  },
  {
    name: 'alert-dialog-demo',
    render: renderInteractiveDemo(GalleryAlertDialogDemo),
    title: 'Alert Dialog',
  },
  {
    name: 'autocomplete-demo',
    render: renderInteractiveDemo(GalleryAutocompleteDemo),
    title: 'Autocomplete',
  },
  {
    name: 'checkbox-demo',
    render: renderInteractiveDemo(GalleryCheckboxDemo),
    title: 'Checkbox',
  },
  {
    name: 'checkbox-group-demo',
    render: renderInteractiveDemo(GalleryCheckboxGroupDemo),
    title: 'Checkbox Group',
  },
  {
    name: 'collapsible-demo',
    render: renderInteractiveDemo(GalleryCollapsibleDemo),
    title: 'Collapsible',
  },
  {
    name: 'combobox-demo',
    render: renderInteractiveDemo(GalleryComboboxDemo),
    title: 'Combobox',
  },
  {
    name: 'command-demo',
    render: renderInteractiveDemo(GalleryCommandDemo),
    title: 'Command',
  },
  {
    name: 'context-menu-demo',
    render: renderInteractiveDemo(GalleryContextMenuDemo),
    title: 'Context Menu',
  },
  {
    name: 'dialog-demo',
    render: renderInteractiveDemo(GalleryDialogDemo),
    title: 'Dialog',
  },
  {
    name: 'drawer-demo',
    render: renderInteractiveDemo(GalleryDrawerDemo),
    title: 'Drawer',
  },
  {
    name: 'disclosure-demo',
    render: renderInteractiveDemo(GalleryDisclosureDemo),
    title: 'Disclosure',
  },
  {
    name: 'dropdown-menu-demo',
    render: renderInteractiveDemo(GalleryDropdownMenuDemo),
    title: 'Dropdown Menu',
  },
  {
    name: 'field-demo',
    render: renderInteractiveDemo(GalleryFieldDemo),
    title: 'Field',
  },
  {
    name: 'hover-card-demo',
    render: renderInteractiveDemo(GalleryHoverCardDemo),
    title: 'Hover Card',
  },
  {
    name: 'menubar-demo',
    render: renderInteractiveDemo(GalleryMenubarDemo),
    title: 'Menubar',
  },
  {
    name: 'meter-demo',
    render: renderInteractiveDemo(GalleryMeterDemo),
    title: 'Meter',
  },
  {
    name: 'navigation-menu-demo',
    render: renderInteractiveDemo(GalleryNavigationMenuDemo),
    title: 'Navigation Menu',
  },
  {
    name: 'number-field-demo',
    render: renderInteractiveDemo(GalleryNumberFieldDemo),
    title: 'Number Field',
  },
  {
    name: 'otp-field-demo',
    render: renderInteractiveDemo(GalleryOtpFieldDemo),
    title: 'OTP Field',
  },
  {
    name: 'popover-demo',
    render: renderInteractiveDemo(GalleryPopoverDemo),
    title: 'Popover',
  },
  {
    name: 'progress-demo',
    render: renderInteractiveDemo(GalleryProgressDemo),
    title: 'Progress',
  },
  {
    name: 'pure-markup-demo',
    render: renderInteractiveDemo(GalleryPureMarkupDemo),
    title: 'Pure Markup',
  },
  {
    name: 'radio-group-demo',
    render: renderInteractiveDemo(GalleryRadioGroupDemo),
    title: 'Radio Group',
  },
  {
    name: 'scroll-area-demo',
    render: renderInteractiveDemo(GalleryScrollAreaDemo),
    title: 'Scroll Area',
  },
  {
    name: 'select-demo',
    render: renderInteractiveDemo(GallerySelectDemo),
    title: 'Select',
  },
  {
    name: 'sheet-demo',
    render: renderInteractiveDemo(GallerySheetDemo),
    title: 'Sheet',
  },
  {
    name: 'slider-demo',
    render: renderInteractiveDemo(GallerySliderDemo),
    title: 'Slider',
  },
  {
    name: 'switch-demo',
    render: renderInteractiveDemo(GallerySwitchDemo),
    title: 'Switch',
  },
  {
    name: 'tabs-demo',
    render: renderInteractiveDemo(GalleryTabsDemo),
    title: 'Tabs',
  },
  {
    name: 'toast-demo',
    render: renderInteractiveDemo(GalleryToastDemo),
    title: 'Toast',
  },
  {
    name: 'toggle-demo',
    render: renderInteractiveDemo(GalleryToggleDemo),
    title: 'Toggle',
  },
  {
    name: 'toggle-group-demo',
    render: renderInteractiveDemo(GalleryToggleGroupDemo),
    title: 'Toggle Group',
  },
  {
    name: 'toolbar-demo',
    render: renderInteractiveDemo(GalleryToolbarDemo),
    title: 'Toolbar',
  },
  {
    name: 'tooltip-demo',
    render: renderInteractiveDemo(GalleryTooltipDemo),
    title: 'Tooltip',
  },
] as const satisfies readonly InteractiveGalleryDemo[]);

export type InteractiveGalleryDemoName = (typeof interactiveGalleryDemos)[number]['name'];

function renderInteractiveDemo(component: unknown): () => Promise<string> {
  const definition = (
    component as {
      definition: {
        render: (queries: Record<string, never>, state: unknown) => Promise<string> | string;
        state: () => unknown;
      };
    }
  ).definition;

  return async () => String(await definition.render({}, definition.state()));
}
