import type { GalleryComponent } from './demo-fixtures.js';

// Authored one-liner per gallery component. This is the single source of truth
// for the component summaries shown on the human `/gallery/` index and surfaced
// to agents in llms.txt / llms-full.txt (site/src/aux.ts). `galleryRoutes` in
// demo-fixtures.tsx owns the route set + render functions; this catalog owns the
// prose. component-catalog.test.ts asserts the two stay 1:1 (same components,
// same titles, same order) so a new fixture cannot ship without a summary.

export interface GalleryComponentEntry {
  component: GalleryComponent;
  summary: string;
  title: string;
}

export const galleryComponentCatalog: readonly GalleryComponentEntry[] = Object.freeze([
  {
    component: 'accordion',
    summary:
      'Vertically stacked headers that each expand to reveal a panel, with single- or multi-open behavior.',
    title: 'Accordion',
  },
  {
    component: 'alert',
    summary: 'A statically rendered status banner that surfaces an important inline message.',
    title: 'Alert',
  },
  {
    component: 'alert-dialog',
    summary: 'A modal dialog that interrupts the user to confirm or cancel a consequential action.',
    title: 'Alert Dialog',
  },
  {
    component: 'autocomplete',
    summary:
      'A text input that suggests matching options as you type while keeping native typing intact.',
    title: 'Autocomplete',
  },
  {
    component: 'avatar',
    summary:
      'A user image with an automatic fallback to initials or a placeholder when it fails to load.',
    title: 'Avatar',
  },
  {
    component: 'badge',
    summary: 'A small inline count or status label attached to another element.',
    title: 'Badge',
  },
  {
    component: 'breadcrumb',
    summary: "An ordered trail of links showing the current page's position in the hierarchy.",
    title: 'Breadcrumb',
  },
  {
    component: 'button',
    summary: 'The base interactive control, with variant, size, and disabled/loading states.',
    title: 'Button',
  },
  {
    component: 'card',
    summary:
      'A surface container that groups related content with optional header, body, and footer.',
    title: 'Card',
  },
  {
    component: 'checkbox',
    summary: 'A single toggle for an on/off (or indeterminate) boolean value.',
    title: 'Checkbox',
  },
  {
    component: 'checkbox-group',
    summary: 'A set of related checkboxes managed as one multi-select value.',
    title: 'Checkbox Group',
  },
  {
    component: 'collapsible',
    summary:
      'A native <details>/<summary> reveal that expands or collapses one region and works without JavaScript — the simplest progressive-enhancement show/hide.',
    title: 'Collapsible',
  },
  {
    component: 'combobox',
    summary: 'An input paired with a filterable listbox for selecting one option from many.',
    title: 'Combobox',
  },
  {
    component: 'command',
    summary: 'A searchable command palette that filters actions and runs the selected one.',
    title: 'Command',
  },
  {
    component: 'context-menu',
    summary: 'A right-click menu of actions anchored to the element it targets.',
    title: 'Context Menu',
  },
  {
    component: 'dialog',
    summary:
      'A focus-trapped modal overlay for content or forms, dismissible by escape or backdrop.',
    title: 'Dialog',
  },
  {
    component: 'disclosure',
    summary:
      'A scripted reveal pairing a <button aria-expanded> trigger with a controlled region, for show/hide cases that need full control over a non-native trigger and content.',
    title: 'Disclosure',
  },
  {
    component: 'drawer',
    summary: 'A panel that slides in from a screen edge, often for navigation or filters.',
    title: 'Drawer',
  },
  {
    component: 'dropdown-menu',
    summary: 'A button-triggered menu of actions with keyboard navigation.',
    title: 'Dropdown Menu',
  },
  {
    component: 'field',
    summary:
      'A labeled form-control wrapper that wires up label, description, and error messaging.',
    title: 'Field',
  },
  {
    component: 'hover-card',
    summary: 'A rich preview card that opens on hover or focus of its trigger.',
    title: 'Hover Card',
  },
  {
    component: 'kbd',
    summary: 'Inline styling for a keyboard key or shortcut chord.',
    title: 'Kbd',
  },
  {
    component: 'menubar',
    summary: "A horizontal bar of menus, like a desktop application's menu strip.",
    title: 'Menubar',
  },
  {
    component: 'meter',
    summary: 'A static gauge showing a scalar value within a known range.',
    title: 'Meter',
  },
  {
    component: 'navigation-menu',
    summary: 'A site navigation bar with expandable submenus.',
    title: 'Navigation Menu',
  },
  {
    component: 'number-field',
    summary: 'A numeric input with stepper buttons and min/max/step constraints.',
    title: 'Number Field',
  },
  {
    component: 'otp-field',
    summary: 'A segmented input for entering a one-time passcode digit by digit.',
    title: 'OTP Field',
  },
  {
    component: 'popover',
    summary: 'A non-modal floating panel anchored to a trigger.',
    title: 'Popover',
  },
  {
    component: 'progress',
    summary: 'A bar that communicates the completion percentage of a task.',
    title: 'Progress',
  },
  {
    component: 'radio-group',
    summary: 'A set of mutually exclusive options where exactly one is selected.',
    title: 'Radio Group',
  },
  {
    component: 'scroll-area',
    summary: 'A custom-styled scroll container with consistent cross-browser scrollbars.',
    title: 'Scroll Area',
  },
  {
    component: 'select',
    summary: 'A trigger that opens a listbox to choose one option, with a native fallback.',
    title: 'Select',
  },
  {
    component: 'separator',
    summary: 'A semantic or decorative divider between groups of content.',
    title: 'Separator',
  },
  {
    component: 'sheet',
    summary: 'A large panel that slides over the page from an edge for secondary tasks.',
    title: 'Sheet',
  },
  {
    component: 'skeleton',
    summary: 'A placeholder shape that stands in for content while it loads.',
    title: 'Skeleton',
  },
  {
    component: 'slider',
    summary: 'A draggable thumb that selects a value or range along a track.',
    title: 'Slider',
  },
  {
    component: 'switch',
    summary: 'A toggle styled as an on/off switch for an immediate boolean setting.',
    title: 'Switch',
  },
  {
    component: 'table',
    summary: 'A semantic data table with header, body, and styled rows.',
    title: 'Table',
  },
  {
    component: 'tabs',
    summary: 'A set of tabbed panels where one panel is visible at a time.',
    title: 'Tabs',
  },
  {
    component: 'toast',
    summary: 'A transient, non-blocking notification that auto-dismisses.',
    title: 'Toast',
  },
  {
    component: 'toggle',
    summary: 'A two-state button that stays pressed or unpressed.',
    title: 'Toggle',
  },
  {
    component: 'toggle-group',
    summary: 'A set of toggle buttons acting as a single- or multi-select control.',
    title: 'Toggle Group',
  },
  {
    component: 'toolbar',
    summary: 'A container grouping buttons and controls with roving-tabindex navigation.',
    title: 'Toolbar',
  },
  {
    component: 'tooltip',
    summary: 'A small label that appears on hover or focus to describe its trigger.',
    title: 'Tooltip',
  },
]);
