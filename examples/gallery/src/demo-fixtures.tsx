/** @jsxImportSource @kovojs/server */
import {
  MeterDemo,
  NumberFieldDemo,
  OtpFieldDemo,
  ToggleDemo,
  ToggleGroupDemo,
  ToolbarDemo,
  RadioGroupDemo,
  ScrollAreaDemo,
  SelectDemo,
  SeparatorDemo,
  SheetDemo,
  DrawerDemo,
  SkeletonDemo,
  SliderDemo,
  SwitchDemo,
  TableDemo,
  TabsDemo,
  ToastDemo,
  PopoverDemo,
  ProgressDemo,
  TooltipDemo,
} from './demo-fixtures-controls.js';
export {
  MeterDemo,
  NumberFieldDemo,
  OtpFieldDemo,
  ToggleDemo,
  ToggleGroupDemo,
  ToolbarDemo,
  RadioGroupDemo,
  ScrollAreaDemo,
  SelectDemo,
  SeparatorDemo,
  SheetDemo,
  DrawerDemo,
  SkeletonDemo,
  SliderDemo,
  SwitchDemo,
  TableDemo,
  TabsDemo,
  ToastDemo,
  PopoverDemo,
  ProgressDemo,
  TooltipDemo,
} from './demo-fixtures-controls.js';
import * as style from '@kovojs/style';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@kovojs/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@kovojs/ui/alert-dialog';
import { Alert } from '@kovojs/ui/alert';
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
} from '@kovojs/ui/autocomplete';
import { Avatar, AvatarFallback, AvatarImage } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from '@kovojs/ui/breadcrumb';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import {
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
} from '@kovojs/ui/checkbox-group';
import { Checkbox } from '@kovojs/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kovojs/ui/collapsible';
import {
  Combobox,
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
} from '@kovojs/ui/combobox';
import {
  Command,
  CommandClose,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandListbox,
  CommandTrigger,
  CommandValue,
} from '@kovojs/ui/command';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@kovojs/ui/context-menu';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@kovojs/ui/dialog';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@kovojs/ui/disclosure';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kovojs/ui/dropdown-menu';
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSelect,
  FieldSelectOption,
  FieldTextarea,
  Fieldset,
  FieldsetLegend,
} from '@kovojs/ui/field';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@kovojs/ui/hover-card';
import { Kbd } from '@kovojs/ui/kbd';
import { Menubar, MenubarItem, MenubarSubmenu } from '@kovojs/ui/menubar';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from '@kovojs/ui/navigation-menu';

export type GalleryComponent =
  | 'accordion'
  | 'alert'
  | 'alert-dialog'
  | 'autocomplete'
  | 'avatar'
  | 'badge'
  | 'breadcrumb'
  | 'button'
  | 'card'
  | 'checkbox'
  | 'checkbox-group'
  | 'collapsible'
  | 'combobox'
  | 'command'
  | 'context-menu'
  | 'dialog'
  | 'disclosure'
  | 'drawer'
  | 'dropdown-menu'
  | 'field'
  | 'hover-card'
  | 'kbd'
  | 'menubar'
  | 'meter'
  | 'navigation-menu'
  | 'number-field'
  | 'otp-field'
  | 'popover'
  | 'progress'
  | 'radio-group'
  | 'scroll-area'
  | 'select'
  | 'separator'
  | 'sheet'
  | 'skeleton'
  | 'slider'
  | 'switch'
  | 'table'
  | 'tabs'
  | 'toast'
  | 'toggle'
  | 'toggle-group'
  | 'toolbar'
  | 'tooltip';

export type GalleryPrimitive = GalleryComponent;

export interface GalleryRoute {
  component: GalleryComponent;
  path: `/components/${GalleryComponent}`;
  render(): string;
  title: string;
}

export interface GalleryFixture {
  component: GalleryComponent;
  html: string;
  path: GalleryRoute['path'];
  title: string;
}

export const galleryRoutes: readonly GalleryRoute[] = Object.freeze([
  {
    component: 'accordion',
    path: '/components/accordion',
    render: () => AccordionDemo(),
    title: 'Accordion',
  },
  {
    component: 'alert',
    path: '/components/alert',
    render: () => AlertDemo(),
    title: 'Alert',
  },
  {
    component: 'alert-dialog',
    path: '/components/alert-dialog',
    render: () => AlertDialogDemo(),
    title: 'Alert Dialog',
  },
  {
    component: 'autocomplete',
    path: '/components/autocomplete',
    render: () => AutocompleteDemo(),
    title: 'Autocomplete',
  },
  {
    component: 'avatar',
    path: '/components/avatar',
    render: () => AvatarDemo(),
    title: 'Avatar',
  },
  {
    component: 'badge',
    path: '/components/badge',
    render: () => BadgeDemo(),
    title: 'Badge',
  },
  {
    component: 'breadcrumb',
    path: '/components/breadcrumb',
    render: () => BreadcrumbDemo(),
    title: 'Breadcrumb',
  },
  {
    component: 'button',
    path: '/components/button',
    render: () => ButtonDemo(),
    title: 'Button',
  },
  {
    component: 'card',
    path: '/components/card',
    render: () => CardDemo(),
    title: 'Card',
  },
  {
    component: 'checkbox',
    path: '/components/checkbox',
    render: () => CheckboxDemo(),
    title: 'Checkbox',
  },
  {
    component: 'checkbox-group',
    path: '/components/checkbox-group',
    render: () => CheckboxGroupDemo(),
    title: 'Checkbox Group',
  },
  {
    component: 'collapsible',
    path: '/components/collapsible',
    render: () => CollapsibleDemo(),
    title: 'Collapsible',
  },
  {
    component: 'combobox',
    path: '/components/combobox',
    render: () => ComboboxDemo(),
    title: 'Combobox',
  },
  {
    component: 'command',
    path: '/components/command',
    render: () => CommandDemo(),
    title: 'Command',
  },
  {
    component: 'context-menu',
    path: '/components/context-menu',
    render: () => ContextMenuDemo(),
    title: 'Context Menu',
  },
  {
    component: 'dialog',
    path: '/components/dialog',
    render: () => DialogDemo(),
    title: 'Dialog',
  },
  {
    component: 'disclosure',
    path: '/components/disclosure',
    render: () => DisclosureDemo(),
    title: 'Disclosure',
  },
  {
    component: 'drawer',
    path: '/components/drawer',
    render: () => DrawerDemo(),
    title: 'Drawer',
  },
  {
    component: 'dropdown-menu',
    path: '/components/dropdown-menu',
    render: () => DropdownMenuDemo(),
    title: 'Dropdown Menu',
  },
  {
    component: 'field',
    path: '/components/field',
    render: () => FieldDemo(),
    title: 'Field',
  },
  {
    component: 'hover-card',
    path: '/components/hover-card',
    render: () => HoverCardDemo(),
    title: 'Hover Card',
  },
  {
    component: 'kbd',
    path: '/components/kbd',
    render: () => KbdDemo(),
    title: 'Kbd',
  },
  {
    component: 'menubar',
    path: '/components/menubar',
    render: () => MenubarDemo(),
    title: 'Menubar',
  },
  {
    component: 'meter',
    path: '/components/meter',
    render: () => MeterDemo(),
    title: 'Meter',
  },
  {
    component: 'navigation-menu',
    path: '/components/navigation-menu',
    render: () => NavigationMenuDemo(),
    title: 'Navigation Menu',
  },
  {
    component: 'number-field',
    path: '/components/number-field',
    render: () => NumberFieldDemo(),
    title: 'Number Field',
  },
  {
    component: 'otp-field',
    path: '/components/otp-field',
    render: () => OtpFieldDemo(),
    title: 'OTP Field',
  },
  {
    component: 'popover',
    path: '/components/popover',
    render: () => PopoverDemo(),
    title: 'Popover',
  },
  {
    component: 'progress',
    path: '/components/progress',
    render: () => ProgressDemo(),
    title: 'Progress',
  },
  {
    component: 'radio-group',
    path: '/components/radio-group',
    render: () => RadioGroupDemo(),
    title: 'Radio Group',
  },
  {
    component: 'scroll-area',
    path: '/components/scroll-area',
    render: () => ScrollAreaDemo(),
    title: 'Scroll Area',
  },
  {
    component: 'select',
    path: '/components/select',
    render: () => SelectDemo(),
    title: 'Select',
  },
  {
    component: 'separator',
    path: '/components/separator',
    render: () => SeparatorDemo(),
    title: 'Separator',
  },
  {
    component: 'sheet',
    path: '/components/sheet',
    render: () => SheetDemo(),
    title: 'Sheet',
  },
  {
    component: 'skeleton',
    path: '/components/skeleton',
    render: () => SkeletonDemo(),
    title: 'Skeleton',
  },
  {
    component: 'slider',
    path: '/components/slider',
    render: () => SliderDemo(),
    title: 'Slider',
  },
  {
    component: 'switch',
    path: '/components/switch',
    render: () => SwitchDemo(),
    title: 'Switch',
  },
  {
    component: 'table',
    path: '/components/table',
    render: () => TableDemo(),
    title: 'Table',
  },
  {
    component: 'tabs',
    path: '/components/tabs',
    render: () => TabsDemo(),
    title: 'Tabs',
  },
  {
    component: 'toast',
    path: '/components/toast',
    render: () => ToastDemo(),
    title: 'Toast',
  },
  {
    component: 'toggle',
    path: '/components/toggle',
    render: () => ToggleDemo(),
    title: 'Toggle',
  },
  {
    component: 'toggle-group',
    path: '/components/toggle-group',
    render: () => ToggleGroupDemo(),
    title: 'Toggle Group',
  },
  {
    component: 'toolbar',
    path: '/components/toolbar',
    render: () => ToolbarDemo(),
    title: 'Toolbar',
  },
  {
    component: 'tooltip',
    path: '/components/tooltip',
    render: () => TooltipDemo(),
    title: 'Tooltip',
  },
]);

export function galleryFixtures(): readonly GalleryFixture[] {
  return galleryRoutes.map((route) => ({
    component: route.component,
    html: renderGalleryRoute(route),
    path: route.path,
    title: route.title,
  }));
}

export function renderGalleryRoute(route: GalleryRoute): string {
  return decodeTrustedGalleryHtml(
    renderedValueToHtml(
      <main data-gallery-route={route.path}>
        <nav aria-label="Components">
          {galleryRoutes.map((candidate) => (
            <a
              aria-current={candidate.path === route.path ? 'page' : undefined}
              href={candidate.path}
            >
              {candidate.title}
            </a>
          ))}
        </nav>
        <h1>{route.title}</h1>
        {route.render()}
      </main>,
    ),
  );
}

function renderedValueToHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  if (typeof value === 'object' && typeof (value as { html?: unknown }).html === 'string') {
    return (value as { html: string }).html;
  }

  return JSON.stringify(value) ?? '';
}

function decodeTrustedGalleryHtml(html: string): string {
  let decoded = html;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function AccordionDemo(): string {
  const state = {
    orientation: 'vertical' as const,
    type: 'multiple' as const,
    value: ['shipping'],
  };
  const shipping = { ...state, itemValue: 'shipping' };
  const billing = { ...state, itemValue: 'billing' };

  return (
    <section data-gallery-demo="accordion">
      <p data-demo-summary="no-js">
        Accordion keeps each item addressable with native-friendly open and hidden attributes.
      </p>
      <div data-ui-demo="accordion">
        {Accordion.definition.render({
          ...state,
          children:
            AccordionItem.definition.render({
              ...shipping,
              children:
                AccordionHeader.definition.render({
                  ...shipping,
                  children: AccordionTrigger.definition.render({
                    ...shipping,
                    children: 'Shipping',
                    contentId: 'gallery-accordion-shipping-panel',
                    triggerId: 'gallery-accordion-shipping-trigger',
                  }),
                  level: 3,
                }) +
                AccordionContent.definition.render({
                  ...shipping,
                  children: 'Ships from the nearest warehouse.',
                  contentId: 'gallery-accordion-shipping-panel',
                  triggerId: 'gallery-accordion-shipping-trigger',
                }),
            }) +
            AccordionItem.definition.render({
              ...billing,
              children:
                AccordionHeader.definition.render({
                  ...billing,
                  children: AccordionTrigger.definition.render({
                    ...billing,
                    children: 'Billing',
                    contentId: 'gallery-accordion-billing-panel',
                    triggerId: 'gallery-accordion-billing-trigger',
                  }),
                  level: 3,
                }) +
                AccordionContent.definition.render({
                  ...billing,
                  children: 'Invoices remain available after checkout.',
                  contentId: 'gallery-accordion-billing-panel',
                  triggerId: 'gallery-accordion-billing-trigger',
                }),
            }),
          id: 'gallery-accordion',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native button activation opens an item; group keyboard maps are primitive-owned',
      })}
    </section>
  );
}

// Real, same-origin SVG portraits served from site/public/avatars/. A data-URI
// would be neutralized to "#" by the compiler's `src` output-sanitizer (data: is
// not an allowed scheme), so the loaded avatars must be committed static assets
// (gradient disc + monogram). The `error` fixture intentionally points at a
// missing file to exercise the initials fallback / data-state="error" visual.
export function AvatarDemo(): string {
  const loading = {
    src: '/avatars/ada.svg',
    status: 'loading' as const,
  };
  const loaded = {
    src: '/avatars/grace.svg',
    status: 'loaded' as const,
  };
  const error = {
    src: '/avatars/missing.png',
    status: 'error' as const,
  };

  return (
    <section data-gallery-demo="avatar">
      <p data-demo-summary="no-js">
        Avatar keeps native image loading visible and leaves initials fallback markup in the
        document.
      </p>
      <div data-ui-demo="avatar">
        {Avatar.definition.render({
          ...loading,
          children:
            AvatarImage.definition.render({
              ...loading,
              alt: 'Ada Lovelace',
              decoding: 'async',
              loading: 'lazy',
              sizes: '40px',
            }) + AvatarFallback.definition.render({ ...loading, children: 'AL', delayMs: 250 }),
          label: 'Ada Lovelace avatar',
        })}
        {Avatar.definition.render({
          ...loaded,
          children:
            AvatarImage.definition.render({ ...loaded, alt: 'Grace Hopper' }) +
            AvatarFallback.definition.render({ ...loaded, children: 'GH' }),
          label: 'Grace Hopper avatar',
        })}
        {Avatar.definition.render({
          ...error,
          children:
            AvatarImage.definition.render({ ...error, alt: 'Lin Wei' }) +
            AvatarFallback.definition.render({ ...error, children: 'LW' }),
          label: 'Lin Wei avatar',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'image-load, image-error, programmatic',
        dataState: 'loading, loaded, error',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function AlertDemo(): string {
  return (
    <section data-gallery-demo="alert">
      <p data-demo-summary="no-js">
        Alert keeps status and alert roles in source-authored markup with no client behavior.
      </p>
      <div data-ui-demo="alert">
        {Alert.definition.render({
          children: 'Imports completed successfully.',
          title: 'Import complete',
          variant: 'success',
        })}
        {Alert.definition.render({
          children: 'Payment method must be updated before renewal.',
          role: 'alert',
          title: 'Billing issue',
          variant: 'danger',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function AlertDialogDemo(): string {
  const state = {
    contentId: 'gallery-alert-dialog-content',
    descriptionId: 'gallery-alert-dialog-description',
    open: true,
    titleId: 'gallery-alert-dialog-title',
  };

  return (
    <section data-gallery-demo="alert-dialog">
      <p data-demo-summary="no-js">
        Alert dialog keeps destructive confirmation controls wired to a native dialog element.
      </p>
      <div data-ui-demo="alert-dialog">
        {AlertDialog.definition.render({
          ...state,
          children:
            AlertDialogTrigger.definition.render({
              ...state,
              children: 'Delete project',
              open: false,
            }) +
            AlertDialogContent.definition.render({
              ...state,
              children:
                '<h2 id="gallery-alert-dialog-title">Delete production project?</h2><p id="gallery-alert-dialog-description">This action removes deploy tokens and cannot be undone.</p>' +
                AlertDialogCancel.definition.render({
                  ...state,
                  autoFocus: true,
                  children: 'Cancel',
                }) +
                AlertDialogAction.definition.render({
                  ...state,
                  children: 'Delete',
                  intent: 'destructive',
                }),
            }),
          id: 'gallery-alert-dialog',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, cancel-click, action-click, cancel-event, native-beforetoggle, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape cancels the native alert dialog',
      })}
    </section>
  );
}

export function AutocompleteDemo(): string {
  const items = [
    { label: 'Starter plan', value: 'starter' },
    { label: 'Growth plan', value: 'growth' },
    { disabled: true, label: 'Enterprise plan', value: 'enterprise' },
  ];
  const state = {
    descriptionId: 'gallery-autocomplete-description',
    form: 'gallery-autocomplete-form',
    highlightedValue: 'growth',
    inputValue: 'gr',
    items,
    listId: 'gallery-autocomplete-list',
    name: 'gallery-plan-search',
    open: true,
    required: true,
    value: 'growth',
  };

  return (
    <section data-gallery-demo="autocomplete">
      <p data-demo-summary="no-js">
        Autocomplete keeps a native text input and ARIA listbox pair for form submission and
        keyboard suggestions.
      </p>
      <label id="gallery-autocomplete-label" for="gallery-autocomplete-input">
        Plan search
      </label>
      <form id="gallery-autocomplete-form" data-gallery-form="autocomplete" />
      <div data-ui-demo="autocomplete">
        {Autocomplete.definition.render({
          ...state,
          children: (
            <>
              {AutocompleteInput.definition.render({
                ...state,
                id: 'gallery-autocomplete-input',
                labelledBy: 'gallery-autocomplete-label',
                placeholder: 'Search plans',
              })}
              {AutocompleteList.definition.render({
                ...state,
                children: items
                  .map((item) =>
                    AutocompleteOption.definition.render({
                      ...state,
                      itemLabel: item.label,
                      itemValue: item.value,
                    }),
                  )
                  .join(''),
                id: 'gallery-autocomplete-list',
                labelledBy: 'gallery-autocomplete-label',
              })}
              {AutocompleteValue.definition.render({
                ...state,
                id: 'gallery-autocomplete-value',
              })}
              <p id="gallery-autocomplete-description">Suggestions remain browser-native.</p>
            </>
          ),
          id: 'gallery-autocomplete',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, option-select, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, highlighted, disabled',
        keyboard: 'Arrow keys open and move over enabled suggestions; Escape closes suggestions',
      })}
    </section>
  );
}

export function BadgeDemo(): string {
  return (
    <section data-gallery-demo="badge">
      <p data-demo-summary="no-js">
        Badge is a pure styled source component with no behavior island.
      </p>
      <div data-ui-demo="badge">
        {Badge.definition.render({ children: 'Draft', variant: 'neutral' })}
        {Badge.definition.render({ children: 'Live', variant: 'success' })}
        {Badge.definition.render({ children: 'Needs review', variant: 'warning' })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function BreadcrumbDemo(): string {
  const account = BreadcrumbItem.definition.render({
    children: BreadcrumbLink.definition.render({ children: 'Account', href: '/account' }),
  });
  const separator = BreadcrumbSeparator.definition.render({});
  const billing = BreadcrumbItem.definition.render({
    children: BreadcrumbLink.definition.render({
      children: 'Billing',
      current: true,
    }),
  });

  return (
    <section data-gallery-demo="breadcrumb">
      <p data-demo-summary="no-js">
        Breadcrumb is a native navigation list with current-page and decorative separator semantics.
      </p>
      <div data-ui-demo="breadcrumb">
        {Breadcrumb.definition.render({
          children: `${account}${separator}${billing}`,
          label: 'Account path',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'native link navigation',
        dataState: 'not emitted',
        keyboard: 'Native link keyboard behavior',
      })}
    </section>
  );
}

export function ButtonDemo(): string {
  return (
    <section data-gallery-demo="button">
      <p data-demo-summary="no-js">
        Button keeps the native button element and submit/reset behavior available without JS.
      </p>
      <form id="gallery-button-form" data-gallery-form="button" />
      <div data-ui-demo="button">
        {Button.definition.render({
          children: 'Save changes',
          form: 'gallery-button-form',
          name: 'gallery-action',
          type: 'submit',
          value: 'save',
        })}
        {Button.definition.render({ children: 'Preview', variant: 'secondary' })}
        {Button.definition.render({ children: 'Archived', disabled: true, variant: 'ghost' })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'native click or form submit',
        dataState: 'disabled via native attribute',
        keyboard: 'Space or Enter activates the native button',
      })}
    </section>
  );
}

export function CardDemo(): string {
  return (
    <section data-gallery-demo="card">
      <p data-demo-summary="no-js">Card is pure markup around authored TSX children.</p>
      <div data-ui-demo="card">
        {Card.definition.render({ children: '<h2>Release candidate</h2><p>Ready for audit.</p>' })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function CheckboxDemo(): string {
  return (
    <section data-gallery-demo="checkbox">
      <p data-demo-summary="no-js">
        Checkbox preserves real checkbox controls for form submission and validation.
      </p>
      <form id="gallery-checkbox-form" data-gallery-form="checkbox" />
      <span hidden id="gallery-checkbox-help">
        Required native checkbox linked to an external form owner.
      </span>
      <div data-ui-demo="checkbox">
        <span data-fixture-state="checked">
          {Checkbox.definition.render({
            checked: true,
            children: 'Accept terms',
            describedBy: 'gallery-checkbox-help',
            form: 'gallery-checkbox-form',
            id: 'gallery-checkbox-consent',
            name: 'gallery-consent',
            required: true,
            value: 'accepted',
          })}
        </span>
        <span data-fixture-state="indeterminate">
          {Checkbox.definition.render({
            checked: 'indeterminate',
            children: 'Some permissions',
            name: 'gallery-partial',
            value: 'partial',
          })}
        </span>
        <span data-fixture-state="disabled">
          {Checkbox.definition.render({
            checked: false,
            children: 'Locked option',
            disabled: true,
          })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'checked, unchecked, indeterminate, disabled',
        keyboard: 'Space toggles the native checkbox',
      })}
    </section>
  );
}

export function CheckboxGroupDemo(): string {
  const items = [{ value: 'updates' }, { value: 'billing' }, { disabled: true, value: 'security' }];
  const state = {
    descriptionId: 'gallery-checkbox-group-description',
    form: 'gallery-checkbox-group-form',
    items,
    name: 'gallery-notifications',
    required: true,
    value: ['updates'] as const,
  };

  return (
    <section data-gallery-demo="checkbox-group">
      <p data-demo-summary="no-js">
        Checkbox group keeps each choice as a native checkbox while grouping labels, validation, and
        roving tabindex.
      </p>
      <h2 id="gallery-checkbox-group-label">Notifications</h2>
      <p id="gallery-checkbox-group-description">Choose which account notifications to receive.</p>
      <p id="gallery-checkbox-group-error">Select at least one notification type.</p>
      <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
      <div data-ui-demo="checkbox-group">
        {CheckboxGroup.definition.render({
          ...state,
          children: items
            .map((item) =>
              CheckboxGroupItem.definition.render({
                ...state,
                children: (
                  <>
                    {CheckboxGroupControl.definition.render({
                      ...state,
                      controlId: `gallery-checkbox-group-${item.value}`,
                      itemValue: item.value,
                    })}
                    {CheckboxGroupLabel.definition.render({
                      ...state,
                      children: item.value,
                      controlId: `gallery-checkbox-group-${item.value}`,
                      itemValue: item.value,
                    })}
                  </>
                ),
                itemValue: item.value,
              }),
            )
            .join(''),
          errorId: 'gallery-checkbox-group-error',
          invalid: true,
          labelledBy: 'gallery-checkbox-group-label',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'checked, unchecked, disabled',
        keyboard: 'Arrow keys move focus over enabled checkbox items; Space toggles focused item',
      })}
    </section>
  );
}

export function CollapsibleDemo(): string {
  const state = {
    contentId: 'gallery-collapsible-content',
    open: true,
  };

  return (
    <section data-gallery-demo="collapsible">
      <p data-demo-summary="no-js">
        Collapsible uses native details disclosure while keeping primitive state attrs on each
        styled part.
      </p>
      <div data-ui-demo="collapsible">
        {Collapsible.definition.render({
          children:
            CollapsibleTrigger.definition.render({ ...state, children: 'Release notes' }) +
            CollapsibleContent.definition.render({
              ...state,
              children: 'Includes dependency updates and migration notes.',
            }),
          id: 'gallery-collapsible',
          open: state.open,
        })}
        {Collapsible.definition.render({
          children:
            CollapsibleTrigger.definition.render({
              children: 'Archived notes',
              contentId: 'gallery-collapsible-disabled-content',
              disabled: true,
            }) +
            CollapsibleContent.definition.render({
              children: 'Archived content remains present for no-JS readers.',
              contentId: 'gallery-collapsible-disabled-content',
            }),
          disabled: true,
          id: 'gallery-collapsible-disabled',
          open: false,
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native summary toggles the details element',
      })}
    </section>
  );
}

export function ComboboxDemo(): string {
  const items = [
    { label: 'Ada Lovelace', value: 'ada' },
    { label: 'Grace Hopper', value: 'grace' },
    { disabled: true, label: 'Katherine Johnson', value: 'katherine' },
  ];
  const state = {
    descriptionId: 'gallery-combobox-description',
    form: 'gallery-combobox-form',
    highlightedValue: 'grace',
    items,
    listboxId: 'gallery-combobox-listbox',
    name: 'gallery-assignee',
    open: true,
    placeholder: 'Search people',
    required: true,
    value: 'ada',
  };

  return (
    <section data-gallery-demo="combobox">
      <p data-demo-summary="no-js">
        Combobox keeps the submitted value on a native input while listbox options expose ARIA
        selection and highlight state.
      </p>
      <label id="gallery-combobox-label" for="gallery-combobox-input">
        Assignee
      </label>
      <form id="gallery-combobox-form" data-gallery-form="combobox" />
      <div data-ui-demo="combobox">
        {Combobox.definition.render({
          ...state,
          children: (
            <>
              {ComboboxInput.definition.render({
                ...state,
                id: 'gallery-combobox-input',
                labelledBy: 'gallery-combobox-label',
              })}
              {ComboboxListbox.definition.render({
                ...state,
                children: items
                  .map((item, index) =>
                    ComboboxOption.definition.render({
                      ...state,
                      id: `gallery-combobox-listbox-option-${index}`,
                      itemLabel: item.label,
                      itemValue: item.value,
                    }),
                  )
                  .join(''),
                id: 'gallery-combobox-listbox',
                labelledBy: 'gallery-combobox-label',
              })}
              {ComboboxValue.definition.render({ ...state, id: 'gallery-combobox-value' })}
              <p id="gallery-combobox-description">Choose a release owner.</p>
            </>
          ),
          id: 'gallery-combobox',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, option-select, arrow-key, escape-key, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, highlighted, disabled',
        keyboard: 'Arrow keys open and move over enabled options; Escape closes the listbox',
      })}
    </section>
  );
}

export function CommandDemo(): string {
  const items = [
    { label: 'Open dashboard', value: 'dashboard' },
    { label: 'Invite teammate', value: 'invite' },
    { disabled: true, label: 'Delete project', value: 'delete' },
  ];
  const state = {
    form: 'gallery-command-form',
    highlightedValue: 'invite',
    inputValue: '',
    items,
    name: 'gallery-command-query',
    open: true,
    placeholder: 'Type a command',
    required: true,
    value: 'invite',
  };

  return (
    <section data-gallery-demo="command">
      <p data-demo-summary="no-js">
        Command keeps a native dialog invoker with combobox/listbox semantics for command search.
      </p>
      <div data-ui-demo="command">
        <form id="gallery-command-form"></form>
        {Command.definition.render({
          ...state,
          children: (
            <>
              {CommandTrigger.definition.render({
                ...state,
                contentId: 'gallery-command-dialog',
                id: 'gallery-command-trigger',
              })}
              {CommandDialog.definition.render({
                ...state,
                children: (
                  <>
                    <h2 id="gallery-command-title">Command menu</h2>
                    <p id="gallery-command-description">Search project actions.</p>
                    {CommandInput.definition.render({
                      ...state,
                      id: 'gallery-command-input',
                      labelledBy: 'gallery-command-title',
                      listboxId: 'gallery-command-listbox',
                    })}
                    {CommandListbox.definition.render({
                      ...state,
                      children: items
                        .map((item) =>
                          CommandItem.definition.render({
                            ...state,
                            id: `gallery-command-listbox-item-${items.indexOf(item)}`,
                            ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                            itemLabel: item.label,
                            itemValue: item.value,
                          }),
                        )
                        .join(''),
                      id: 'gallery-command-listbox',
                      labelledBy: 'gallery-command-title',
                    })}
                    {CommandEmpty.definition.render({
                      inputValue: 'zzz',
                      items,
                      children: 'No matching command',
                    })}
                    {CommandClose.definition.render({
                      ...state,
                      contentId: 'gallery-command-dialog',
                    })}
                    {CommandValue.definition.render({
                      ...state,
                      id: 'gallery-command-value',
                    })}
                  </>
                ),
                contentId: 'gallery-command-dialog',
                descriptionId: 'gallery-command-description',
                titleId: 'gallery-command-title',
              })}
            </>
          ),
          id: 'gallery-command',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, input, item-click, enter-key, escape-key, close-click, cancel-event, native-beforetoggle, programmatic',
        dataState: 'open, closed, active, inactive, highlighted, disabled',
        keyboard: 'Arrow keys move command options; Enter selects; Escape closes the dialog',
      })}
    </section>
  );
}

export function ContextMenuDemo(): string {
  const items = [
    { label: 'Copy link', value: 'copy' },
    { disabled: true, label: 'Delete', value: 'delete' },
    { label: 'Inspect', value: 'inspect' },
  ];
  const state = {
    highlightedValue: 'inspect',
    items,
    open: true,
    point: { x: 24, y: 32 },
  };

  return (
    <section data-gallery-demo="context-menu">
      <p data-demo-summary="no-js">
        Context menu keeps package-prefixed trigger wiring and menuitem roving state inspectable.
      </p>
      <div data-ui-demo="context-menu">
        {ContextMenu.definition.render({
          ...state,
          children: (
            <>
              {ContextMenuTrigger.definition.render({
                ...state,
                contentId: 'gallery-context-menu-content',
                id: 'gallery-context-menu-trigger',
              })}
              {ContextMenuContent.definition.render({
                ...state,
                children: items
                  .map((item) =>
                    ContextMenuItem.definition.render({
                      ...state,
                      id: `gallery-context-menu-${item.value}`,
                      ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                      itemLabel: item.label,
                      itemValue: item.value,
                    }),
                  )
                  .join(''),
                id: 'gallery-context-menu-content',
              })}
            </>
          ),
          id: 'gallery-context-menu',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-context-menu, keyboard-open, item-click, item-keyboard, escape-key, programmatic',
        dataState: 'open, closed, highlighted, disabled',
        keyboard:
          'Context menu key or Shift+F10 opens; Arrow keys move; Enter or Space selects items',
      })}
    </section>
  );
}

export function DialogDemo(): string {
  const root = { open: true };
  const trigger = {
    contentId: 'gallery-dialog-content',
    open: false,
  };
  const content = {
    contentId: 'gallery-dialog-content',
    descriptionId: 'gallery-dialog-description',
    open: true,
    titleId: 'gallery-dialog-title',
  };
  const close = {
    contentId: 'gallery-dialog-content',
    open: true,
  };

  return (
    <section data-gallery-demo="dialog">
      <p data-demo-summary="no-js">
        Native dialog invoker commands keep the open and close controls meaningful without client
        JavaScript.
      </p>
      <div data-ui-demo="dialog">
        {Dialog.definition.render({
          ...root,
          children:
            DialogTrigger.definition.render({ ...trigger, children: 'Open preview' }) +
            DialogContent.definition.render({
              ...content,
              children:
                '<h2 id="gallery-dialog-title">Publish gallery changes</h2><p id="gallery-dialog-description">Review the demo route before publishing.</p>' +
                DialogClose.definition.render({ ...close, children: 'Close' }),
            }),
          id: 'gallery-dialog',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, close-click, cancel-event, native-beforetoggle, programmatic',
        dataState: 'open, closed',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function DisclosureDemo(): string {
  const state = {
    contentId: 'gallery-disclosure-content',
    open: true,
  };

  return (
    <section data-gallery-demo="disclosure">
      <p data-demo-summary="no-js">
        Disclosure keeps an explicit button and hidden panel wiring for progressively enhanced
        state.
      </p>
      <div data-ui-demo="disclosure">
        {Disclosure.definition.render({
          children:
            DisclosureTrigger.definition.render({ ...state, children: 'Show audit details' }) +
            DisclosureContent.definition.render({
              ...state,
              children: 'Two reviewers approved the release.',
            }),
          id: 'gallery-disclosure',
          open: state.open,
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Space or Enter activates the disclosure button',
      })}
    </section>
  );
}

export function DropdownMenuDemo(): string {
  const items = [
    { label: 'Duplicate', value: 'duplicate' },
    { disabled: true, label: 'Archive', value: 'archive' },
    { label: 'Rename', value: 'rename' },
  ];
  const state = {
    highlightedValue: 'rename',
    items,
    open: true,
  };

  return (
    <section data-gallery-demo="dropdown-menu">
      <p data-demo-summary="no-js">
        Dropdown menu keeps the trigger, menu, and menuitem roving state visible in static markup.
      </p>
      <div data-ui-demo="dropdown-menu">
        {DropdownMenu.definition.render({
          ...state,
          children: (
            <>
              {DropdownMenuTrigger.definition.render({
                ...state,
                contentId: 'gallery-dropdown-menu-content',
                id: 'gallery-dropdown-menu-trigger',
              })}
              {DropdownMenuContent.definition.render({
                ...state,
                children: items
                  .map((item) =>
                    DropdownMenuItem.definition.render({
                      ...state,
                      id: `gallery-dropdown-menu-${item.value}`,
                      ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                      itemLabel: item.label,
                      itemValue: item.value,
                    }),
                  )
                  .join(''),
                id: 'gallery-dropdown-menu-content',
              })}
            </>
          ),
          id: 'gallery-dropdown-menu',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, arrow-key, item-click, item-keyboard, escape-key, typeahead, programmatic',
        dataState: 'open, closed, highlighted, disabled',
        keyboard: 'Arrow keys open and move; Enter or Space selects items; Escape closes the menu',
      })}
    </section>
  );
}

export function FieldDemo(): string {
  const fieldState = {
    invalid: true,
    required: true,
  };

  return (
    <section data-gallery-demo="field">
      <p data-demo-summary="no-js">
        Field helpers wire labels, descriptions, errors, and native controls without hidden inputs.
      </p>
      <form id="gallery-field-external-form" method="post" action="/gallery/field" />
      <div data-ui-demo="field">
        {Field.definition.render({
          ...fieldState,
          children: (
            <>
              {FieldLabel.definition.render({
                ...fieldState,
                children: 'Email',
                controlId: 'gallery-field-email',
                id: 'gallery-field-label',
              })}
              {FieldControl.definition.render({
                ...fieldState,
                autoComplete: 'email',
                descriptionId: 'gallery-field-description',
                errorId: 'gallery-field-error',
                form: 'gallery-field-external-form',
                id: 'gallery-field-email',
                inputMode: 'email',
                maxLength: 80,
                minLength: 3,
                name: 'email',
                pattern: '.+@example\\.com',
                placeholder: 'ada@example.com',
                type: 'email',
              })}
              {FieldDescription.definition.render({
                children: 'Used for release notifications.',
                id: 'gallery-field-description',
              })}
              {FieldError.definition.render({
                children: 'Email is required.',
                id: 'gallery-field-error',
              })}
            </>
          ),
          id: 'gallery-field',
        })}
        {Field.definition.render({
          children: (
            <>
              {FieldLabel.definition.render({
                children: 'Profile note',
                controlId: 'gallery-field-bio',
                id: 'gallery-field-bio-label',
              })}
              {FieldTextarea.definition.render({
                autoComplete: 'off',
                children: 'Prefers changelog emails and release candidate previews.',
                descriptionId: 'gallery-field-bio-description',
                form: 'gallery-field-external-form',
                id: 'gallery-field-bio',
                maxLength: 240,
                name: 'bio',
                rows: 3,
              })}
              {FieldDescription.definition.render({
                children: 'Textarea keeps the same description IDREF contract as inputs.',
                id: 'gallery-field-bio-description',
              })}
            </>
          ),
          id: 'gallery-field-bio-row',
        })}
        {Field.definition.render({
          children: (
            <>
              {FieldLabel.definition.render({
                children: 'Workspace plan',
                controlId: 'gallery-field-plan',
                id: 'gallery-field-plan-label',
                required: true,
              })}
              {FieldSelect.definition.render({
                children:
                  FieldSelectOption.definition.render({ children: 'Starter', value: 'starter' }) +
                  FieldSelectOption.definition.render({
                    children: 'Team',
                    selected: true,
                    value: 'team',
                  }) +
                  FieldSelectOption.definition.render({
                    children: 'Enterprise',
                    disabled: true,
                    value: 'enterprise',
                  }),
                descriptionId: 'gallery-field-plan-description',
                form: 'gallery-field-external-form',
                id: 'gallery-field-plan',
                name: 'plan',
                required: true,
                value: 'team',
              })}
              {FieldDescription.definition.render({
                children: 'Select controls preserve native option submission.',
                id: 'gallery-field-plan-description',
              })}
            </>
          ),
          id: 'gallery-field-plan-row',
          required: true,
        })}
        {Fieldset.definition.render({
          children: (
            <>
              {FieldsetLegend.definition.render({
                children: 'Plan',
                id: 'gallery-fieldset-legend',
              })}
              {FieldLabel.definition.render({
                children: 'Seat preference',
                controlId: 'gallery-fieldset-seat',
                id: 'gallery-fieldset-seat-label',
              })}
              {FieldControl.definition.render({
                descriptionId: 'gallery-fieldset-description',
                form: 'gallery-field-external-form',
                id: 'gallery-fieldset-seat',
                name: 'seat',
                value: 'window',
              })}
              {FieldDescription.definition.render({
                children: 'Fieldset preserves the native grouping element.',
                id: 'gallery-fieldset-description',
              })}
            </>
          ),
          descriptionId: 'gallery-fieldset-description',
          disabled: true,
          form: 'gallery-field-external-form',
          id: 'gallery-fieldset',
          invalid: true,
          name: 'seat-options',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'native form control changes',
        dataState: 'invalid, required, disabled',
        keyboard: 'Native field and fieldset semantics',
      })}
    </section>
  );
}

export function HoverCardDemo(): string {
  const state = {
    contentId: 'gallery-hover-card-content',
    open: true,
  };

  return (
    <section data-gallery-demo="hover-card">
      <p data-demo-summary="no-js">
        Hover card uses a package-prefixed behavior attribute on the trigger and keeps popover
        content in the document.
      </p>
      <div data-ui-demo="hover-card">
        {HoverCard.definition.render({
          children:
            HoverCardTrigger.definition.render({
              ...state,
              children: 'Ada Lovelace',
              href: '/team/ada',
            }) +
            HoverCardContent.definition.render({
              ...state,
              children: '<strong>Compiler owner</strong><p>Maintains release quality gates.</p>',
            }),
          id: 'gallery-hover-card',
          open: state.open,
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-pointer-enter, trigger-pointer-leave, trigger-focus, trigger-blur, content-pointer-enter, content-pointer-leave, content-focus, content-blur, escape-key, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Focus opens the hover card; Escape closes it',
      })}
    </section>
  );
}

export function KbdDemo(): string {
  const kbdDemoStyles = style.create({
    uppercase: {
      textTransform: 'uppercase',
    },
  });

  return (
    <section data-gallery-demo="kbd">
      <p data-demo-summary="no-js">
        Keyboard hints remain semantic kbd elements and do not require behavior wiring.
      </p>
      <div data-ui-demo="kbd">
        {Kbd.definition.render({ children: 'Ctrl' })}
        {Kbd.definition.render({ children: 'K', style: kbdDemoStyles.uppercase })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function MenubarDemo(): string {
  const items = [
    { hasPopup: true, label: 'File', value: 'file' },
    { label: 'Edit', value: 'edit' },
    { label: 'New', parentValue: 'file', value: 'new' },
    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
  ];
  const state = {
    activeValue: 'file',
    items,
    openValue: 'file',
  };

  return (
    <section data-gallery-demo="menubar">
      <p data-demo-summary="no-js">
        Menubar keeps top-level and submenu items in one roving collection with menu popup state.
      </p>
      <div data-ui-demo="menubar">
        {Menubar.definition.render({
          ...state,
          children: (
            <>
              {MenubarItem.definition.render({
                ...state,
                contentId: 'gallery-menubar-file-menu',
                id: 'gallery-menubar-file',
                itemLabel: 'File',
                itemValue: 'file',
              })}
              {MenubarItem.definition.render({
                ...state,
                id: 'gallery-menubar-edit',
                itemLabel: 'Edit',
                itemValue: 'edit',
              })}
              {MenubarSubmenu.definition.render({
                ...state,
                children: (
                  <>
                    {MenubarItem.definition.render({
                      ...state,
                      activeValue: 'new',
                      id: 'gallery-menubar-new',
                      itemLabel: 'New',
                      itemParentValue: 'file',
                      itemValue: 'new',
                    })}
                    {MenubarItem.definition.render({
                      ...state,
                      activeValue: 'new',
                      id: 'gallery-menubar-import',
                      itemDisabled: true,
                      itemLabel: 'Import',
                      itemParentValue: 'file',
                      itemValue: 'import',
                    })}
                  </>
                ),
                id: 'gallery-menubar-file-menu',
                labelledBy: 'gallery-menubar-file',
                value: 'file',
              })}
            </>
          ),
          label: 'Document commands',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'item-click, item-keyboard, item-pointer-enter, item-select, escape-key, programmatic',
        dataState: 'open, closed, highlighted, disabled, orientation',
        keyboard: 'Arrow keys move across top-level items and nested menus',
      })}
    </section>
  );
}

export function NavigationMenuDemo(): string {
  const items = [
    { hasContent: true, label: 'Products', value: 'products' },
    { label: 'Docs', value: 'docs' },
  ];
  const state = {
    activeValue: 'products',
    items,
    openValue: 'products',
  };

  return (
    <section data-gallery-demo="navigation-menu">
      <p data-demo-summary="no-js">
        Navigation menu keeps links native while trigger content uses roving and disclosure state.
      </p>
      <div data-ui-demo="navigation-menu">
        {NavigationMenu.definition.render({
          ...state,
          children: (
            <>
              {NavigationMenuList.definition.render({
                ...state,
                children: (
                  <>
                    {NavigationMenuItem.definition.render({
                      ...state,
                      children: NavigationMenuTrigger.definition.render({
                        ...state,
                        contentId: 'gallery-navigation-products-panel',
                        id: 'gallery-navigation-products-trigger',
                        itemLabel: 'Products',
                        itemValue: 'products',
                      }),
                      id: 'gallery-navigation-products-item',
                      itemValue: 'products',
                    })}
                    {NavigationMenuItem.definition.render({
                      ...state,
                      children: NavigationMenuLink.definition.render({
                        ...state,
                        href: '/docs',
                        id: 'gallery-navigation-docs-link',
                        itemLabel: 'Docs',
                        itemValue: 'docs',
                      }),
                      id: 'gallery-navigation-docs-item',
                      itemValue: 'docs',
                    })}
                  </>
                ),
                id: 'gallery-navigation-list',
              })}
              {NavigationMenuContent.definition.render({
                ...state,
                children: 'Product links stay grouped with their trigger.',
                id: 'gallery-navigation-products-panel',
                labelledBy: 'gallery-navigation-products-trigger',
                value: 'products',
              })}
              {NavigationMenuViewport.definition.render({
                ...state,
                id: 'gallery-navigation-viewport',
              })}
            </>
          ),
          label: 'Primary navigation',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, trigger-focus, trigger-keyboard, trigger-pointer-enter, link-click, escape-key, programmatic',
        dataState: 'open, closed, highlighted, disabled, orientation',
        keyboard: 'Arrow keys move across navigation items; Enter or Space opens trigger content',
      })}
    </section>
  );
}

function renderBehaviorContract(props: {
  changeReasons: string;
  dataState: string;
  keyboard: string;
}): string {
  // G1 fixtures intentionally expose the SPEC.md §4.6 behavior surface as
  // HTML so later G2/G3/G5 gates can assert against the same rendered demos.
  return (
    <table data-gallery-contract>
      <tbody>
        <tr>
          <th scope="row">data-state</th>
          <td>{props.dataState}</td>
        </tr>
        <tr>
          <th scope="row">keyboard</th>
          <td>{props.keyboard}</td>
        </tr>
        <tr>
          <th scope="row">change reasons</th>
          <td>{props.changeReasons}</td>
        </tr>
      </tbody>
    </table>
  );
}
