// Generated from packages/ui/scripts/primitive-component-manifest.mjs. Run `node packages/ui/scripts/build-registry.mjs --write`.

import type { GalleryComponent } from './gallery-component-manifest.js';

export interface GalleryComponentEntry {
  anatomy: {
    ids: readonly string[];
    parts: readonly string[];
    slots: readonly string[];
    stateInputs: readonly string[];
  };
  component: GalleryComponent;
  copyCommand: string;
  enhancement: {
    accessibility: string;
    keyboard: string;
    roles: readonly string[];
    tier: 'none' | 'native' | 'progressive' | 'scripted';
  };
  headlessImport: string | null;
  packageImport: string;
  searchText: string;
  summary: string;
  title: string;
}

export const galleryComponentCatalog: readonly GalleryComponentEntry[] = Object.freeze([
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'item', 'header', 'trigger', 'content'],
      slots: ['root', 'item', 'header', 'trigger', 'content'],
      stateInputs: ['disabled', 'open', 'orientation', 'type', 'value'],
    },
    component: 'accordion',
    copyCommand: 'kovo add accordion',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button, region role contract.',
      keyboard:
        'Enter or Space toggles an item; Arrow keys, Home, and End move focus between triggers.',
      roles: ['button', 'region'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/accordion',
    packageImport: '@kovojs/ui/accordion',
    searchText:
      'accordion Accordion Vertically stacked headers that each expand to reveal a panel, with single- or multi-open behavior. @kovojs/ui/accordion kovo add accordion root item header trigger content button region Enter or Space toggles an item; Arrow keys, Home, and End move focus between triggers. The rendered anatomy owns the button, region role contract.',
    summary:
      'Vertically stacked headers that each expand to reveal a panel, with single- or multi-open behavior.',
    title: 'Accordion',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: [],
    },
    component: 'alert',
    copyCommand: 'kovo add alert',
    enhancement: {
      accessibility: 'The status message is exposed through the alert role without client code.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['alert'],
      tier: 'none',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/alert',
    searchText:
      'alert Alert A statically rendered status banner that surfaces an important inline message. @kovojs/ui/alert kovo add alert root alert No custom keyboard behavior; the rendered native elements keep their platform behavior. The status message is exposed through the alert role without client code.',
    summary: 'A statically rendered status banner that surfaces an important inline message.',
    title: 'Alert',
  },
  {
    anatomy: {
      ids: ['contentId', 'descriptionId', 'titleId', 'triggerId'],
      parts: [
        'root',
        'trigger',
        'content',
        'cancel',
        'action',
        'header',
        'title',
        'description',
        'footer',
      ],
      slots: [
        'root',
        'trigger',
        'content',
        'cancel',
        'action',
        'header',
        'title',
        'description',
        'footer',
      ],
      stateInputs: ['actionIntent', 'disabled', 'open'],
    },
    component: 'alert-dialog',
    copyCommand: 'kovo add alert-dialog',
    enhancement: {
      accessibility: 'The rendered anatomy owns the alertdialog, button role contract.',
      keyboard:
        'Enter or Space opens and activates controls; Tab stays in the modal and Escape cancels it.',
      roles: ['alertdialog', 'button'],
      tier: 'progressive',
    },
    headlessImport: '@kovojs/headless-ui/alert-dialog',
    packageImport: '@kovojs/ui/alert-dialog',
    searchText:
      'alert-dialog Alert Dialog A modal dialog that interrupts the user to confirm or cancel a consequential action. @kovojs/ui/alert-dialog kovo add alert-dialog root trigger content cancel action header title description footer alertdialog button Enter or Space opens and activates controls; Tab stays in the modal and Escape cancels it. The rendered anatomy owns the alertdialog, button role contract.',
    summary: 'A modal dialog that interrupts the user to confirm or cancel a consequential action.',
    title: 'Alert Dialog',
  },
  {
    anatomy: {
      ids: ['inputId', 'listboxId'],
      parts: ['root', 'input', 'list', 'option', 'value'],
      slots: ['root', 'input', 'list', 'option', 'value'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open', 'value'],
    },
    component: 'autocomplete',
    copyCommand: 'kovo add autocomplete',
    enhancement: {
      accessibility: 'The rendered anatomy owns the combobox, listbox, option role contract.',
      keyboard:
        'Arrow keys move the active option, Enter selects it, and Escape closes suggestions.',
      roles: ['combobox', 'listbox', 'option'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/autocomplete',
    packageImport: '@kovojs/ui/autocomplete',
    searchText:
      'autocomplete Autocomplete A text input that suggests matching options as you type while keeping native typing intact. @kovojs/ui/autocomplete kovo add autocomplete root input list option value combobox listbox option Arrow keys move the active option, Enter selects it, and Escape closes suggestions. The rendered anatomy owns the combobox, listbox, option role contract.',
    summary:
      'A text input that suggests matching options as you type while keeping native typing intact.',
    title: 'Autocomplete',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root', 'image', 'fallback'],
      slots: ['root', 'image', 'fallback'],
      stateInputs: ['status'],
    },
    component: 'avatar',
    copyCommand: 'kovo add avatar',
    enhancement: {
      accessibility: 'The rendered anatomy owns the img role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['img'],
      tier: 'progressive',
    },
    headlessImport: '@kovojs/headless-ui/avatar',
    packageImport: '@kovojs/ui/avatar',
    searchText:
      'avatar Avatar A user image with an automatic fallback to initials or a placeholder when it fails to load. @kovojs/ui/avatar kovo add avatar root image fallback img No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the img role contract.',
    summary:
      'A user image with an automatic fallback to initials or a placeholder when it fails to load.',
    title: 'Avatar',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: [],
    },
    component: 'badge',
    copyCommand: 'kovo add badge',
    enhancement: {
      accessibility: 'The rendered semantic HTML remains the accessibility contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: [],
      tier: 'none',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/badge',
    searchText:
      'badge Badge A small inline count or status label attached to another element. @kovojs/ui/badge kovo add badge root No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered semantic HTML remains the accessibility contract.',
    summary: 'A small inline count or status label attached to another element.',
    title: 'Badge',
  },
  {
    anatomy: {
      ids: ['currentId'],
      parts: ['root', 'item', 'link', 'separator'],
      slots: ['root', 'item', 'link', 'separator'],
      stateInputs: ['current'],
    },
    component: 'breadcrumb',
    copyCommand: 'kovo add breadcrumb',
    enhancement: {
      accessibility: 'The rendered anatomy owns the navigation, list role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['navigation', 'list'],
      tier: 'native',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/breadcrumb',
    searchText:
      "breadcrumb Breadcrumb An ordered trail of links showing the current page's position in the hierarchy. @kovojs/ui/breadcrumb kovo add breadcrumb root item link separator navigation list No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the navigation, list role contract.",
    summary: "An ordered trail of links showing the current page's position in the hierarchy.",
    title: 'Breadcrumb',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['disabled', 'loading'],
    },
    component: 'button',
    copyCommand: 'kovo add button',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['button'],
      tier: 'native',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/button',
    searchText:
      'button Button The base interactive control, with variant, size, and disabled/loading states. @kovojs/ui/button kovo add button root button No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the button role contract.',
    summary: 'The base interactive control, with variant, size, and disabled/loading states.',
    title: 'Button',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root', 'header', 'title', 'description', 'content', 'footer'],
      slots: ['root', 'header', 'title', 'description', 'content', 'footer'],
      stateInputs: [],
    },
    component: 'card',
    copyCommand: 'kovo add card',
    enhancement: {
      accessibility: 'The rendered semantic HTML remains the accessibility contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: [],
      tier: 'none',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/card',
    searchText:
      'card Card A surface container that groups related content with optional header, content, and footer. @kovojs/ui/card kovo add card root header title description content footer No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered semantic HTML remains the accessibility contract.',
    summary:
      'A surface container that groups related content with optional header, content, and footer.',
    title: 'Card',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['checked', 'disabled', 'invalid', 'required'],
    },
    component: 'checkbox',
    copyCommand: 'kovo add checkbox',
    enhancement: {
      accessibility: 'The rendered anatomy owns the checkbox role contract.',
      keyboard: 'Space toggles the checkbox while disabled controls remain inert.',
      roles: ['checkbox'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/checkbox',
    packageImport: '@kovojs/ui/checkbox',
    searchText:
      'checkbox Checkbox A single toggle for an on/off (or indeterminate) boolean value. @kovojs/ui/checkbox kovo add checkbox root checkbox Space toggles the checkbox while disabled controls remain inert. The rendered anatomy owns the checkbox role contract.',
    summary: 'A single toggle for an on/off (or indeterminate) boolean value.',
    title: 'Checkbox',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root', 'item', 'control', 'label'],
      slots: ['root', 'item', 'control', 'label'],
      stateInputs: ['disabled', 'items', 'orientation', 'required', 'value'],
    },
    component: 'checkbox-group',
    copyCommand: 'kovo add checkbox-group',
    enhancement: {
      accessibility: 'The rendered anatomy owns the group, checkbox role contract.',
      keyboard: 'Space toggles the focused item; Arrow keys can move roving focus when configured.',
      roles: ['group', 'checkbox'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/checkbox-group',
    packageImport: '@kovojs/ui/checkbox-group',
    searchText:
      'checkbox-group Checkbox Group A set of related checkboxes managed as one multi-select value. @kovojs/ui/checkbox-group kovo add checkbox-group root item control label group checkbox Space toggles the focused item; Arrow keys can move roving focus when configured. The rendered anatomy owns the group, checkbox role contract.',
    summary: 'A set of related checkboxes managed as one multi-select value.',
    title: 'Checkbox Group',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content'],
      slots: ['root', 'trigger', 'content'],
      stateInputs: ['disabled', 'open'],
    },
    component: 'collapsible',
    copyCommand: 'kovo add collapsible',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button role contract.',
      keyboard: 'Enter or Space toggles the native details disclosure.',
      roles: ['button'],
      tier: 'native',
    },
    headlessImport: '@kovojs/headless-ui/collapsible',
    packageImport: '@kovojs/ui/collapsible',
    searchText:
      'collapsible Collapsible A native <details>/<summary> reveal that expands or collapses one region and works without JavaScript - the simplest progressive-enhancement show/hide. @kovojs/ui/collapsible kovo add collapsible root trigger content button Enter or Space toggles the native details disclosure. The rendered anatomy owns the button role contract.',
    summary:
      'A native <details>/<summary> reveal that expands or collapses one region and works without JavaScript - the simplest progressive-enhancement show/hide.',
    title: 'Collapsible',
  },
  {
    anatomy: {
      ids: ['inputId', 'listboxId'],
      parts: ['root', 'input', 'listbox', 'option', 'value'],
      slots: ['root', 'input', 'listbox', 'option', 'value'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open', 'value'],
    },
    component: 'combobox',
    copyCommand: 'kovo add combobox',
    enhancement: {
      accessibility: 'The rendered anatomy owns the combobox, listbox, option role contract.',
      keyboard:
        'Arrow keys move the active option, Enter selects it, and Escape closes the listbox.',
      roles: ['combobox', 'listbox', 'option'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/combobox',
    packageImport: '@kovojs/ui/combobox',
    searchText:
      'combobox Combobox An input paired with a filterable listbox for selecting one option from many. @kovojs/ui/combobox kovo add combobox root input listbox option value combobox listbox option Arrow keys move the active option, Enter selects it, and Escape closes the listbox. The rendered anatomy owns the combobox, listbox, option role contract.',
    summary: 'An input paired with a filterable listbox for selecting one option from many.',
    title: 'Combobox',
  },
  {
    anatomy: {
      ids: ['dialogId', 'inputId', 'listboxId'],
      parts: ['root', 'trigger', 'dialog', 'input', 'listbox', 'item', 'close', 'empty', 'value'],
      slots: ['root', 'trigger', 'dialog', 'input', 'listbox', 'item', 'close', 'empty', 'value'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open', 'value'],
    },
    component: 'command',
    copyCommand: 'kovo add command',
    enhancement: {
      accessibility:
        'The rendered anatomy owns the dialog, combobox, listbox, option role contract.',
      keyboard: 'Arrow keys move the active command, Enter runs it, and Escape closes the palette.',
      roles: ['dialog', 'combobox', 'listbox', 'option'],
      tier: 'progressive',
    },
    headlessImport: '@kovojs/headless-ui/command',
    packageImport: '@kovojs/ui/command',
    searchText:
      'command Command A searchable command palette that filters actions and runs the selected one. @kovojs/ui/command kovo add command root trigger dialog input listbox item close empty value dialog combobox listbox option Arrow keys move the active command, Enter runs it, and Escape closes the palette. The rendered anatomy owns the dialog, combobox, listbox, option role contract.',
    summary: 'A searchable command palette that filters actions and runs the selected one.',
    title: 'Command',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content', 'item', 'group', 'separator'],
      slots: ['root', 'trigger', 'content', 'item', 'group', 'separator'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open', 'point'],
    },
    component: 'context-menu',
    copyCommand: 'kovo add context-menu',
    enhancement: {
      accessibility:
        'The rendered anatomy owns the menu, menuitem, group, separator role contract.',
      keyboard:
        'Context Menu or Shift+F10 opens; Arrow keys, Home, End, typeahead, Enter, and Escape operate the menu.',
      roles: ['menu', 'menuitem', 'group', 'separator'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/context-menu',
    packageImport: '@kovojs/ui/context-menu',
    searchText:
      'context-menu Context Menu A right-click menu of actions anchored to the element it targets. @kovojs/ui/context-menu kovo add context-menu root trigger content item group separator menu menuitem group separator Context Menu or Shift+F10 opens; Arrow keys, Home, End, typeahead, Enter, and Escape operate the menu. The rendered anatomy owns the menu, menuitem, group, separator role contract.',
    summary: 'A right-click menu of actions anchored to the element it targets.',
    title: 'Context Menu',
  },
  {
    anatomy: {
      ids: ['contentId', 'descriptionId', 'titleId', 'triggerId'],
      parts: ['root', 'trigger', 'content', 'close', 'closeX', 'header', 'title', 'description'],
      slots: ['root', 'trigger', 'content', 'close', 'closeX', 'header', 'title', 'description'],
      stateInputs: ['disabled', 'open'],
    },
    component: 'dialog',
    copyCommand: 'kovo add dialog',
    enhancement: {
      accessibility: 'The rendered anatomy owns the dialog, button role contract.',
      keyboard: 'Enter or Space opens controls; Tab stays inside the modal and Escape closes it.',
      roles: ['dialog', 'button'],
      tier: 'progressive',
    },
    headlessImport: '@kovojs/headless-ui/dialog',
    packageImport: '@kovojs/ui/dialog',
    searchText:
      'dialog Dialog A focus-trapped modal overlay for content or forms, dismissible by escape or backdrop. @kovojs/ui/dialog kovo add dialog root trigger content close closeX header title description dialog button Enter or Space opens controls; Tab stays inside the modal and Escape closes it. The rendered anatomy owns the dialog, button role contract.',
    summary:
      'A focus-trapped modal overlay for content or forms, dismissible by escape or backdrop.',
    title: 'Dialog',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content'],
      slots: ['root', 'trigger', 'content'],
      stateInputs: ['disabled', 'open'],
    },
    component: 'disclosure',
    copyCommand: 'kovo add disclosure',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button, region role contract.',
      keyboard: 'Enter or Space toggles the controlled region.',
      roles: ['button', 'region'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/disclosure',
    packageImport: '@kovojs/ui/disclosure',
    searchText:
      'disclosure Disclosure A scripted reveal pairing a <button aria-expanded> trigger with a controlled region, for show/hide cases that need full control over a non-native trigger and content. @kovojs/ui/disclosure kovo add disclosure root trigger content button region Enter or Space toggles the controlled region. The rendered anatomy owns the button, region role contract.',
    summary:
      'A scripted reveal pairing a <button aria-expanded> trigger with a controlled region, for show/hide cases that need full control over a non-native trigger and content.',
    title: 'Disclosure',
  },
  {
    anatomy: {
      ids: ['contentId', 'descriptionId', 'titleId', 'triggerId'],
      parts: ['root', 'trigger', 'content', 'handle', 'header', 'title', 'description', 'close'],
      slots: ['root', 'trigger', 'content', 'handle', 'header', 'title', 'description', 'close'],
      stateInputs: ['disabled', 'open', 'side'],
    },
    component: 'drawer',
    copyCommand: 'kovo add drawer',
    enhancement: {
      accessibility: 'The rendered anatomy owns the dialog, button role contract.',
      keyboard: 'Enter or Space opens controls; Tab is contained and Escape closes.',
      roles: ['dialog', 'button'],
      tier: 'progressive',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/drawer',
    searchText:
      'drawer Drawer A panel that slides in from a screen edge, often for navigation or filters. @kovojs/ui/drawer kovo add drawer root trigger content handle header title description close dialog button Enter or Space opens controls; Tab is contained and Escape closes. The rendered anatomy owns the dialog, button role contract.',
    summary: 'A panel that slides in from a screen edge, often for navigation or filters.',
    title: 'Drawer',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content', 'item', 'group', 'separator'],
      slots: ['root', 'trigger', 'content', 'item', 'group', 'separator'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open'],
    },
    component: 'dropdown-menu',
    copyCommand: 'kovo add dropdown-menu',
    enhancement: {
      accessibility:
        'The rendered anatomy owns the menu, menuitem, group, separator role contract.',
      keyboard:
        'Enter or Space opens; Arrow keys, Home, End, typeahead, Enter, and Escape operate the menu.',
      roles: ['menu', 'menuitem', 'group', 'separator'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/dropdown-menu',
    packageImport: '@kovojs/ui/dropdown-menu',
    searchText:
      'dropdown-menu Dropdown Menu A button-triggered menu of actions with keyboard navigation. @kovojs/ui/dropdown-menu kovo add dropdown-menu root trigger content item group separator menu menuitem group separator Enter or Space opens; Arrow keys, Home, End, typeahead, Enter, and Escape operate the menu. The rendered anatomy owns the menu, menuitem, group, separator role contract.',
    summary: 'A button-triggered menu of actions with keyboard navigation.',
    title: 'Dropdown Menu',
  },
  {
    anatomy: {
      ids: ['controlId', 'descriptionId', 'errorId', 'labelId'],
      parts: [
        'root',
        'label',
        'control',
        'textarea',
        'select',
        'selectOption',
        'description',
        'errorMessage',
        'set',
        'setLegend',
      ],
      slots: [
        'root',
        'label',
        'control',
        'textarea',
        'select',
        'selectOption',
        'description',
        'errorMessage',
        'set',
        'setLegend',
      ],
      stateInputs: ['disabled', 'invalid', 'required'],
    },
    component: 'field',
    copyCommand: 'kovo add field',
    enhancement: {
      accessibility: 'The rendered anatomy owns the group role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['group'],
      tier: 'native',
    },
    headlessImport: '@kovojs/headless-ui/field',
    packageImport: '@kovojs/ui/field',
    searchText:
      'field Field A labeled form-control wrapper that wires up label, description, and error messaging. @kovojs/ui/field kovo add field root label control textarea select selectOption description errorMessage set setLegend group No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the group role contract.',
    summary:
      'A labeled form-control wrapper that wires up label, description, and error messaging.',
    title: 'Field',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content'],
      slots: ['root', 'trigger', 'content'],
      stateInputs: ['open'],
    },
    component: 'hover-card',
    copyCommand: 'kovo add hover-card',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button role contract.',
      keyboard:
        'Focus or pointer entry opens the preview; Escape and focus or pointer exit close it.',
      roles: ['button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/hover-card',
    packageImport: '@kovojs/ui/hover-card',
    searchText:
      'hover-card Hover Card A rich preview card that opens on hover or focus of its trigger. @kovojs/ui/hover-card kovo add hover-card root trigger content button Focus or pointer entry opens the preview; Escape and focus or pointer exit close it. The rendered anatomy owns the button role contract.',
    summary: 'A rich preview card that opens on hover or focus of its trigger.',
    title: 'Hover Card',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: [],
    },
    component: 'kbd',
    copyCommand: 'kovo add kbd',
    enhancement: {
      accessibility: 'The rendered semantic HTML remains the accessibility contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: [],
      tier: 'native',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/kbd',
    searchText:
      'kbd Kbd Inline styling for a keyboard key or shortcut chord. @kovojs/ui/kbd kovo add kbd root No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered semantic HTML remains the accessibility contract.',
    summary: 'Inline styling for a keyboard key or shortcut chord.',
    title: 'Kbd',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'item', 'submenu', 'group', 'separator'],
      slots: ['root', 'item', 'submenu', 'group', 'separator'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'openValue', 'orientation'],
    },
    component: 'menubar',
    copyCommand: 'kovo add menubar',
    enhancement: {
      accessibility:
        'The rendered anatomy owns the menubar, menuitem, menu, separator role contract.',
      keyboard:
        'Arrow keys, Home, End, typeahead, Enter, Space, and Escape operate menus and submenus.',
      roles: ['menubar', 'menuitem', 'menu', 'separator'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/menubar',
    packageImport: '@kovojs/ui/menubar',
    searchText:
      "menubar Menubar A horizontal bar of menus, like a desktop application's menu strip. @kovojs/ui/menubar kovo add menubar root item submenu group separator menubar menuitem menu separator Arrow keys, Home, End, typeahead, Enter, Space, and Escape operate menus and submenus. The rendered anatomy owns the menubar, menuitem, menu, separator role contract.",
    summary: "A horizontal bar of menus, like a desktop application's menu strip.",
    title: 'Menubar',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'labelledBy'],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['high', 'low', 'max', 'min', 'optimum', 'value'],
    },
    component: 'meter',
    copyCommand: 'kovo add meter',
    enhancement: {
      accessibility: 'The rendered anatomy owns the meter role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['meter'],
      tier: 'native',
    },
    headlessImport: '@kovojs/headless-ui/meter',
    packageImport: '@kovojs/ui/meter',
    searchText:
      'meter Meter A static gauge showing a scalar value within a known range. @kovojs/ui/meter kovo add meter root meter No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the meter role contract.',
    summary: 'A static gauge showing a scalar value within a known range.',
    title: 'Meter',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId', 'viewportId'],
      parts: ['root', 'list', 'item', 'trigger', 'content', 'link', 'viewport', 'indicator'],
      slots: ['root', 'list', 'item', 'trigger', 'content', 'link', 'viewport', 'indicator'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'openValue', 'orientation'],
    },
    component: 'navigation-menu',
    copyCommand: 'kovo add navigation-menu',
    enhancement: {
      accessibility: 'The rendered anatomy owns the navigation, list, button role contract.',
      keyboard:
        'Arrow keys, Home, End, typeahead, Enter, Space, and Escape move through navigation items.',
      roles: ['navigation', 'list', 'button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/navigation-menu',
    packageImport: '@kovojs/ui/navigation-menu',
    searchText:
      'navigation-menu Navigation Menu A site navigation bar with expandable submenus. @kovojs/ui/navigation-menu kovo add navigation-menu root list item trigger content link viewport indicator navigation list button Arrow keys, Home, End, typeahead, Enter, Space, and Escape move through navigation items. The rendered anatomy owns the navigation, list, button role contract.',
    summary: 'A site navigation bar with expandable submenus.',
    title: 'Navigation Menu',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root', 'control', 'input', 'decrement', 'increment'],
      slots: ['root', 'control', 'input', 'decrement', 'increment'],
      stateInputs: ['disabled', 'invalid', 'max', 'min', 'step', 'value'],
    },
    component: 'number-field',
    copyCommand: 'kovo add number-field',
    enhancement: {
      accessibility: 'The rendered anatomy owns the spinbutton, button role contract.',
      keyboard: 'Arrow Up and Arrow Down step the value within its declared bounds.',
      roles: ['spinbutton', 'button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/number-field',
    packageImport: '@kovojs/ui/number-field',
    searchText:
      'number-field Number Field A numeric input with stepper buttons and min/max/step constraints. @kovojs/ui/number-field kovo add number-field root control input decrement increment spinbutton button Arrow Up and Arrow Down step the value within its declared bounds. The rendered anatomy owns the spinbutton, button role contract.',
    summary: 'A numeric input with stepper buttons and min/max/step constraints.',
    title: 'Number Field',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root', 'group', 'hiddenInput', 'input'],
      slots: ['root', 'group', 'hiddenInput', 'input'],
      stateInputs: ['disabled', 'invalid', 'length', 'required', 'value'],
    },
    component: 'otp-field',
    copyCommand: 'kovo add otp-field',
    enhancement: {
      accessibility: 'The rendered anatomy owns the group, textbox role contract.',
      keyboard:
        'Typing advances slots, Backspace moves backward, Arrow keys move focus, and paste fills available slots.',
      roles: ['group', 'textbox'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/otp-field',
    packageImport: '@kovojs/ui/otp-field',
    searchText:
      'otp-field OTP Field A segmented input for entering a one-time passcode digit by digit. @kovojs/ui/otp-field kovo add otp-field root group hiddenInput input group textbox Typing advances slots, Backspace moves backward, Arrow keys move focus, and paste fills available slots. The rendered anatomy owns the group, textbox role contract.',
    summary: 'A segmented input for entering a one-time passcode digit by digit.',
    title: 'OTP Field',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content'],
      slots: ['root', 'trigger', 'content'],
      stateInputs: ['disabled', 'open'],
    },
    component: 'popover',
    copyCommand: 'kovo add popover',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button role contract.',
      keyboard: 'Enter or Space opens the popover and Escape closes it.',
      roles: ['button'],
      tier: 'progressive',
    },
    headlessImport: '@kovojs/headless-ui/popover',
    packageImport: '@kovojs/ui/popover',
    searchText:
      'popover Popover A non-modal floating panel anchored to a trigger. @kovojs/ui/popover kovo add popover root trigger content button Enter or Space opens the popover and Escape closes it. The rendered anatomy owns the button role contract.',
    summary: 'A non-modal floating panel anchored to a trigger.',
    title: 'Popover',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'labelledBy'],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['max', 'value'],
    },
    component: 'progress',
    copyCommand: 'kovo add progress',
    enhancement: {
      accessibility: 'The rendered anatomy owns the progressbar role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['progressbar'],
      tier: 'native',
    },
    headlessImport: '@kovojs/headless-ui/progress',
    packageImport: '@kovojs/ui/progress',
    searchText:
      'progress Progress A bar that communicates the completion percentage of a task. @kovojs/ui/progress kovo add progress root progressbar No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the progressbar role contract.',
    summary: 'A bar that communicates the completion percentage of a task.',
    title: 'Progress',
  },
  {
    anatomy: {
      ids: ['controlId', 'descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root', 'item', 'radio', 'label'],
      slots: ['root', 'item', 'radio', 'label'],
      stateInputs: ['disabled', 'items', 'orientation', 'required', 'value'],
    },
    component: 'radio-group',
    copyCommand: 'kovo add radio-group',
    enhancement: {
      accessibility: 'The rendered anatomy owns the radiogroup, radio role contract.',
      keyboard: 'Arrow keys move selection and focus; Space selects the focused radio option.',
      roles: ['radiogroup', 'radio'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/radio-group',
    packageImport: '@kovojs/ui/radio-group',
    searchText:
      'radio-group Radio Group A set of mutually exclusive options where exactly one is selected. @kovojs/ui/radio-group kovo add radio-group root item radio label radiogroup radio Arrow keys move selection and focus; Space selects the focused radio option. The rendered anatomy owns the radiogroup, radio role contract.',
    summary: 'A set of mutually exclusive options where exactly one is selected.',
    title: 'Radio Group',
  },
  {
    anatomy: {
      ids: ['scrollbarId', 'viewportId'],
      parts: ['root', 'viewport', 'scrollbar', 'thumb', 'corner'],
      slots: ['root', 'viewport', 'scrollbar', 'thumb', 'corner'],
      stateInputs: ['orientation', 'scrollSize', 'viewportSize'],
    },
    component: 'scroll-area',
    copyCommand: 'kovo add scroll-area',
    enhancement: {
      accessibility: 'The rendered anatomy owns the scrollbar role contract.',
      keyboard: 'Native viewport scrolling remains available when custom dragging is absent.',
      roles: ['scrollbar'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/scroll-area',
    packageImport: '@kovojs/ui/scroll-area',
    searchText:
      'scroll-area Scroll Area A custom-styled scroll container with consistent cross-browser scrollbars. @kovojs/ui/scroll-area kovo add scroll-area root viewport scrollbar thumb corner scrollbar Native viewport scrolling remains available when custom dragging is absent. The rendered anatomy owns the scrollbar role contract.',
    summary: 'A custom-styled scroll container with consistent cross-browser scrollbars.',
    title: 'Scroll Area',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy', 'listboxId'],
      parts: ['root', 'trigger', 'hiddenInput', 'content', 'item', 'value'],
      slots: ['root', 'trigger', 'hiddenInput', 'content', 'item', 'value'],
      stateInputs: ['disabled', 'highlightedValue', 'items', 'open', 'required', 'value'],
    },
    component: 'select',
    copyCommand: 'kovo add select',
    enhancement: {
      accessibility: 'The rendered anatomy owns the combobox, listbox, option role contract.',
      keyboard:
        'Arrow keys move the active option, Enter or Space selects, typeahead searches, and Escape closes.',
      roles: ['combobox', 'listbox', 'option'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/select',
    packageImport: '@kovojs/ui/select',
    searchText:
      'select Select A trigger that opens a listbox to choose one option, with a native fallback. @kovojs/ui/select kovo add select root trigger hiddenInput content item value combobox listbox option Arrow keys move the active option, Enter or Space selects, typeahead searches, and Escape closes. The rendered anatomy owns the combobox, listbox, option role contract.',
    summary: 'A trigger that opens a listbox to choose one option, with a native fallback.',
    title: 'Select',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['decorative', 'orientation'],
    },
    component: 'separator',
    copyCommand: 'kovo add separator',
    enhancement: {
      accessibility: 'The rendered anatomy owns the separator role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['separator'],
      tier: 'native',
    },
    headlessImport: '@kovojs/headless-ui/separator',
    packageImport: '@kovojs/ui/separator',
    searchText:
      'separator Separator A semantic or decorative divider between groups of content. @kovojs/ui/separator kovo add separator root separator No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the separator role contract.',
    summary: 'A semantic or decorative divider between groups of content.',
    title: 'Separator',
  },
  {
    anatomy: {
      ids: ['contentId', 'descriptionId', 'titleId', 'triggerId'],
      parts: ['root', 'trigger', 'content', 'header', 'title', 'description', 'close'],
      slots: ['root', 'trigger', 'content', 'header', 'title', 'description', 'close'],
      stateInputs: ['disabled', 'open', 'side'],
    },
    component: 'sheet',
    copyCommand: 'kovo add sheet',
    enhancement: {
      accessibility: 'The rendered anatomy owns the dialog, button role contract.',
      keyboard: 'Enter or Space opens controls; Tab is contained and Escape closes.',
      roles: ['dialog', 'button'],
      tier: 'progressive',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/sheet',
    searchText:
      'sheet Sheet A large panel that slides over the page from an edge for secondary tasks. @kovojs/ui/sheet kovo add sheet root trigger content header title description close dialog button Enter or Space opens controls; Tab is contained and Escape closes. The rendered anatomy owns the dialog, button role contract.',
    summary: 'A large panel that slides over the page from an edge for secondary tasks.',
    title: 'Sheet',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: [],
    },
    component: 'skeleton',
    copyCommand: 'kovo add skeleton',
    enhancement: {
      accessibility:
        'The placeholder remains hidden from assistive technology until content loads.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: [],
      tier: 'none',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/skeleton',
    searchText:
      'skeleton Skeleton A placeholder shape that stands in for content while it loads. @kovojs/ui/skeleton kovo add skeleton root No custom keyboard behavior; the rendered native elements keep their platform behavior. The placeholder remains hidden from assistive technology until content loads.',
    summary: 'A placeholder shape that stands in for content while it loads.',
    title: 'Skeleton',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root', 'input', 'track', 'range', 'thumb'],
      slots: ['root', 'input', 'track', 'range', 'thumb'],
      stateInputs: ['disabled', 'max', 'min', 'orientation', 'step', 'value'],
    },
    component: 'slider',
    copyCommand: 'kovo add slider',
    enhancement: {
      accessibility: 'The rendered anatomy owns the slider role contract.',
      keyboard:
        'Arrow keys step the value; Home and End select bounds while pointer drag tracks continuously.',
      roles: ['slider'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/slider',
    packageImport: '@kovojs/ui/slider',
    searchText:
      'slider Slider A draggable thumb that selects a value or range along a track. @kovojs/ui/slider kovo add slider root input track range thumb slider Arrow keys step the value; Home and End select bounds while pointer drag tracks continuously. The rendered anatomy owns the slider role contract.',
    summary: 'A draggable thumb that selects a value or range along a track.',
    title: 'Slider',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'errorId', 'id', 'labelledBy'],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['checked', 'disabled', 'invalid', 'required'],
    },
    component: 'switch',
    copyCommand: 'kovo add switch',
    enhancement: {
      accessibility: 'The rendered anatomy owns the switch role contract.',
      keyboard: 'Space toggles the switch while disabled controls remain inert.',
      roles: ['switch'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/switch',
    packageImport: '@kovojs/ui/switch',
    searchText:
      'switch Switch A toggle styled as an on/off switch for an immediate boolean setting. @kovojs/ui/switch kovo add switch root switch Space toggles the switch while disabled controls remain inert. The rendered anatomy owns the switch role contract.',
    summary: 'A toggle styled as an on/off switch for an immediate boolean setting.',
    title: 'Switch',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root', 'head', 'body', 'row', 'headerCell', 'cell'],
      slots: ['root', 'head', 'body', 'row', 'headerCell', 'cell'],
      stateInputs: [],
    },
    component: 'table',
    copyCommand: 'kovo add table',
    enhancement: {
      accessibility: 'The rendered anatomy owns the table, row, columnheader, cell role contract.',
      keyboard:
        'No custom keyboard behavior; the rendered native elements keep their platform behavior.',
      roles: ['table', 'row', 'columnheader', 'cell'],
      tier: 'native',
    },
    headlessImport: null,
    packageImport: '@kovojs/ui/table',
    searchText:
      'table Table A semantic data table with header, body, and styled rows. @kovojs/ui/table kovo add table root head body row headerCell cell table row columnheader cell No custom keyboard behavior; the rendered native elements keep their platform behavior. The rendered anatomy owns the table, row, columnheader, cell role contract.',
    summary: 'A semantic data table with header, body, and styled rows.',
    title: 'Table',
  },
  {
    anatomy: {
      ids: ['panelId', 'tabId'],
      parts: ['root', 'list', 'trigger', 'panel'],
      slots: ['root', 'list', 'trigger', 'panel'],
      stateInputs: ['activationMode', 'disabled', 'items', 'orientation', 'value'],
    },
    component: 'tabs',
    copyCommand: 'kovo add tabs',
    enhancement: {
      accessibility: 'The rendered anatomy owns the tablist, tab, tabpanel role contract.',
      keyboard:
        'Arrow keys move between tabs; Home and End jump to bounds; Enter or Space activates in manual mode.',
      roles: ['tablist', 'tab', 'tabpanel'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/tabs',
    packageImport: '@kovojs/ui/tabs',
    searchText:
      'tabs Tabs A set of tabbed panels where one panel is visible at a time. @kovojs/ui/tabs kovo add tabs root list trigger panel tablist tab tabpanel Arrow keys move between tabs; Home and End jump to bounds; Enter or Space activates in manual mode. The rendered anatomy owns the tablist, tab, tabpanel role contract.',
    summary: 'A set of tabbed panels where one panel is visible at a time.',
    title: 'Tabs',
  },
  {
    anatomy: {
      ids: ['descriptionId', 'titleId', 'toastId', 'viewportId'],
      parts: ['viewport', 'root', 'title', 'description', 'action', 'close'],
      slots: ['viewport', 'root', 'title', 'description', 'action', 'close'],
      stateInputs: ['duration', 'open', 'type'],
    },
    component: 'toast',
    copyCommand: 'kovo add toast',
    enhancement: {
      accessibility: 'The rendered anatomy owns the region, status role contract.',
      keyboard: 'Escape dismisses the newest toast; native buttons activate actions and close.',
      roles: ['region', 'status'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/toast',
    packageImport: '@kovojs/ui/toast',
    searchText:
      'toast Toast A transient, non-blocking notification that auto-dismisses. @kovojs/ui/toast kovo add toast viewport root title description action close region status Escape dismisses the newest toast; native buttons activate actions and close. The rendered anatomy owns the region, status role contract.',
    summary: 'A transient, non-blocking notification that auto-dismisses.',
    title: 'Toast',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root'],
      slots: ['root'],
      stateInputs: ['disabled', 'pressed'],
    },
    component: 'toggle',
    copyCommand: 'kovo add toggle',
    enhancement: {
      accessibility: 'The rendered anatomy owns the button role contract.',
      keyboard: 'Enter or Space toggles the pressed state.',
      roles: ['button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/toggle',
    packageImport: '@kovojs/ui/toggle',
    searchText:
      'toggle Toggle A two-state button that stays pressed or unpressed. @kovojs/ui/toggle kovo add toggle root button Enter or Space toggles the pressed state. The rendered anatomy owns the button role contract.',
    summary: 'A two-state button that stays pressed or unpressed.',
    title: 'Toggle',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root', 'item', 'button'],
      slots: ['root', 'item', 'button'],
      stateInputs: ['disabled', 'items', 'orientation', 'type', 'value'],
    },
    component: 'toggle-group',
    copyCommand: 'kovo add toggle-group',
    enhancement: {
      accessibility: 'The rendered anatomy owns the group, button role contract.',
      keyboard: 'Arrow keys move roving focus and Enter or Space toggles the focused item.',
      roles: ['group', 'button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/toggle-group',
    packageImport: '@kovojs/ui/toggle-group',
    searchText:
      'toggle-group Toggle Group A set of toggle buttons acting as a single- or multi-select control. @kovojs/ui/toggle-group kovo add toggle-group root item button group button Arrow keys move roving focus and Enter or Space toggles the focused item. The rendered anatomy owns the group, button role contract.',
    summary: 'A set of toggle buttons acting as a single- or multi-select control.',
    title: 'Toggle Group',
  },
  {
    anatomy: {
      ids: [],
      parts: ['root', 'item', 'button'],
      slots: ['root', 'item', 'button'],
      stateInputs: ['disabled', 'items', 'orientation'],
    },
    component: 'toolbar',
    copyCommand: 'kovo add toolbar',
    enhancement: {
      accessibility: 'The rendered anatomy owns the toolbar, button role contract.',
      keyboard: 'Arrow keys, Home, and End move roving focus through toolbar items.',
      roles: ['toolbar', 'button'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/toolbar',
    packageImport: '@kovojs/ui/toolbar',
    searchText:
      'toolbar Toolbar A container grouping buttons and controls with roving-tabindex navigation. @kovojs/ui/toolbar kovo add toolbar root item button toolbar button Arrow keys, Home, and End move roving focus through toolbar items. The rendered anatomy owns the toolbar, button role contract.',
    summary: 'A container grouping buttons and controls with roving-tabindex navigation.',
    title: 'Toolbar',
  },
  {
    anatomy: {
      ids: ['contentId', 'triggerId'],
      parts: ['root', 'trigger', 'content'],
      slots: ['root', 'trigger', 'content'],
      stateInputs: ['open'],
    },
    component: 'tooltip',
    copyCommand: 'kovo add tooltip',
    enhancement: {
      accessibility: 'The rendered anatomy owns the tooltip role contract.',
      keyboard: 'Focus or pointer entry opens the tooltip and Escape closes it.',
      roles: ['tooltip'],
      tier: 'scripted',
    },
    headlessImport: '@kovojs/headless-ui/tooltip',
    packageImport: '@kovojs/ui/tooltip',
    searchText:
      'tooltip Tooltip A small label that appears on hover or focus to describe its trigger. @kovojs/ui/tooltip kovo add tooltip root trigger content tooltip Focus or pointer entry opens the tooltip and Escape closes it. The rendered anatomy owns the tooltip role contract.',
    summary: 'A small label that appears on hover or focus to describe its trigger.',
    title: 'Tooltip',
  },
] as readonly GalleryComponentEntry[]);
