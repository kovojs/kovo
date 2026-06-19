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

type InteractiveDemoComponent = {
  definition: {
    render: (queries: Record<string, never>, state: unknown) => Promise<string> | string;
    state: () => unknown;
  };
};

type InteractiveDemoModule = Record<string, InteractiveDemoComponent | undefined>;

const generatedInteractiveDemoModules = import.meta.glob<InteractiveDemoModule>(
  './generated/interactive/*-demo.tsx',
  { eager: true },
);

export const interactiveGalleryDemos = Object.freeze([
  {
    name: 'accordion-demo',
    render: renderInteractiveDemo('accordion-demo', GalleryAccordionDemo),
    title: 'Accordion',
  },
  {
    name: 'alert-dialog-demo',
    render: renderInteractiveDemo('alert-dialog-demo', GalleryAlertDialogDemo),
    title: 'Alert Dialog',
  },
  {
    name: 'autocomplete-demo',
    render: renderInteractiveDemo('autocomplete-demo', GalleryAutocompleteDemo),
    title: 'Autocomplete',
  },
  {
    name: 'checkbox-demo',
    render: renderInteractiveDemo('checkbox-demo', GalleryCheckboxDemo),
    title: 'Checkbox',
  },
  {
    name: 'checkbox-group-demo',
    render: renderInteractiveDemo('checkbox-group-demo', GalleryCheckboxGroupDemo),
    title: 'Checkbox Group',
  },
  {
    name: 'collapsible-demo',
    render: renderInteractiveDemo('collapsible-demo', GalleryCollapsibleDemo),
    title: 'Collapsible',
  },
  {
    name: 'combobox-demo',
    render: renderInteractiveDemo('combobox-demo', GalleryComboboxDemo),
    title: 'Combobox',
  },
  {
    name: 'command-demo',
    render: renderInteractiveDemo('command-demo', GalleryCommandDemo),
    title: 'Command',
  },
  {
    name: 'context-menu-demo',
    render: renderInteractiveDemo('context-menu-demo', GalleryContextMenuDemo),
    title: 'Context Menu',
  },
  {
    name: 'dialog-demo',
    render: renderInteractiveDemo('dialog-demo', GalleryDialogDemo),
    title: 'Dialog',
  },
  {
    name: 'drawer-demo',
    render: renderInteractiveDemo('drawer-demo', GalleryDrawerDemo),
    title: 'Drawer',
  },
  {
    name: 'disclosure-demo',
    render: renderInteractiveDemo('disclosure-demo', GalleryDisclosureDemo),
    title: 'Disclosure',
  },
  {
    name: 'dropdown-menu-demo',
    render: renderInteractiveDemo('dropdown-menu-demo', GalleryDropdownMenuDemo),
    title: 'Dropdown Menu',
  },
  {
    name: 'field-demo',
    render: renderInteractiveDemo('field-demo', GalleryFieldDemo),
    title: 'Field',
  },
  {
    name: 'hover-card-demo',
    render: renderInteractiveDemo('hover-card-demo', GalleryHoverCardDemo),
    title: 'Hover Card',
  },
  {
    name: 'menubar-demo',
    render: renderInteractiveDemo('menubar-demo', GalleryMenubarDemo),
    title: 'Menubar',
  },
  {
    name: 'meter-demo',
    render: renderInteractiveDemo('meter-demo', GalleryMeterDemo),
    title: 'Meter',
  },
  {
    name: 'navigation-menu-demo',
    render: renderInteractiveDemo('navigation-menu-demo', GalleryNavigationMenuDemo),
    title: 'Navigation Menu',
  },
  {
    name: 'number-field-demo',
    render: renderInteractiveDemo('number-field-demo', GalleryNumberFieldDemo),
    title: 'Number Field',
  },
  {
    name: 'otp-field-demo',
    render: renderInteractiveDemo('otp-field-demo', GalleryOtpFieldDemo),
    title: 'OTP Field',
  },
  {
    name: 'popover-demo',
    render: renderInteractiveDemo('popover-demo', GalleryPopoverDemo),
    title: 'Popover',
  },
  {
    name: 'progress-demo',
    render: renderInteractiveDemo('progress-demo', GalleryProgressDemo),
    title: 'Progress',
  },
  {
    name: 'pure-markup-demo',
    render: renderInteractiveDemo('pure-markup-demo', GalleryPureMarkupDemo),
    title: 'Pure Markup',
  },
  {
    name: 'radio-group-demo',
    render: renderInteractiveDemo('radio-group-demo', GalleryRadioGroupDemo),
    title: 'Radio Group',
  },
  {
    name: 'scroll-area-demo',
    render: renderInteractiveDemo('scroll-area-demo', GalleryScrollAreaDemo),
    title: 'Scroll Area',
  },
  {
    name: 'select-demo',
    render: renderInteractiveDemo('select-demo', GallerySelectDemo),
    title: 'Select',
  },
  {
    name: 'sheet-demo',
    render: renderInteractiveDemo('sheet-demo', GallerySheetDemo),
    title: 'Sheet',
  },
  {
    name: 'slider-demo',
    render: renderInteractiveDemo('slider-demo', GallerySliderDemo),
    title: 'Slider',
  },
  {
    name: 'switch-demo',
    render: renderInteractiveDemo('switch-demo', GallerySwitchDemo),
    title: 'Switch',
  },
  {
    name: 'tabs-demo',
    render: renderInteractiveDemo('tabs-demo', GalleryTabsDemo),
    title: 'Tabs',
  },
  {
    name: 'toast-demo',
    render: renderInteractiveDemo('toast-demo', GalleryToastDemo),
    title: 'Toast',
  },
  {
    name: 'toggle-demo',
    render: renderInteractiveDemo('toggle-demo', GalleryToggleDemo),
    title: 'Toggle',
  },
  {
    name: 'toggle-group-demo',
    render: renderInteractiveDemo('toggle-group-demo', GalleryToggleGroupDemo),
    title: 'Toggle Group',
  },
  {
    name: 'toolbar-demo',
    render: renderInteractiveDemo('toolbar-demo', GalleryToolbarDemo),
    title: 'Toolbar',
  },
  {
    name: 'tooltip-demo',
    render: renderInteractiveDemo('tooltip-demo', GalleryTooltipDemo),
    title: 'Tooltip',
  },
] as const satisfies readonly InteractiveGalleryDemo[]);

export type InteractiveGalleryDemoName = (typeof interactiveGalleryDemos)[number]['name'];

function resolveInteractiveDemo(
  name: string,
  sourceComponent: InteractiveDemoComponent,
): InteractiveDemoComponent {
  const module = generatedInteractiveDemoModules[`./generated/interactive/${name}.tsx`];
  if (module === undefined) return sourceComponent;

  const generatedComponent = module[`Gallery${pascalCase(name.replace(/-demo$/, ''))}Demo`];
  if (generatedComponent === undefined) {
    throw new Error(`Generated gallery interactive demo ${name} did not export its component.`);
  }

  return generatedComponent;
}

function renderInteractiveDemo(
  name: string,
  sourceComponent: InteractiveDemoComponent,
): () => Promise<string> {
  let resolvedComponent: InteractiveDemoComponent | undefined;

  return async () => {
    resolvedComponent ??= resolveInteractiveDemo(name, sourceComponent);
    const definition = resolvedComponent.definition;
    return String(await definition.render({}, definition.state()));
  };
}

function pascalCase(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}
