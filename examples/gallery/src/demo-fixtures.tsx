/** @jsxImportSource @jiso/server */
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarRootAttributes,
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  meterRootAttributes,
  progressRootAttributes,
  separatorRootAttributes,
  tabsRootAttributes,
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';
import {
  Alert,
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Combobox,
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
  Command,
  CommandClose,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandListbox,
  CommandTrigger,
  CommandValue,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSelect,
  FieldTextarea,
  Fieldset,
  FieldsetLegend,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  Menubar,
  MenubarItem,
  MenubarSubmenu,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  OtpField,
  OtpFieldGroup,
  OtpFieldHiddenInput,
  OtpFieldInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  Skeleton,
  Slider,
  SliderInput,
  SliderRange,
  SliderThumb,
  SliderTrack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupButton,
  ToggleGroupItem,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  Toolbar,
  ToolbarButton,
  ToolbarItem,
} from '@jiso/ui';

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
  return (
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
    </main>
  );
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
    <section {...accordionRootAttributes(state)} data-gallery-demo="accordion">
      <p data-demo-summary="no-js">
        Accordion keeps each item addressable with native-friendly open and hidden attributes.
      </p>
      <div {...accordionItemAttributes(shipping)}>
        <h3 {...accordionHeaderAttributes({ ...shipping, level: 3 })}>
          <button
            {...accordionTriggerAttributes({
              ...shipping,
              contentId: 'gallery-accordion-shipping-panel',
              triggerId: 'gallery-accordion-shipping-trigger',
            })}
          >
            Shipping
          </button>
        </h3>
        <div
          {...accordionContentAttributes({
            ...shipping,
            contentId: 'gallery-accordion-shipping-panel',
            triggerId: 'gallery-accordion-shipping-trigger',
          })}
        >
          Ships from the nearest warehouse.
        </div>
      </div>
      <div {...accordionItemAttributes(billing)}>
        <h3 {...accordionHeaderAttributes({ ...billing, level: 3 })}>
          <button
            {...accordionTriggerAttributes({
              ...billing,
              contentId: 'gallery-accordion-billing-panel',
              triggerId: 'gallery-accordion-billing-trigger',
            })}
          >
            Billing
          </button>
        </h3>
        <div
          {...accordionContentAttributes({
            ...billing,
            contentId: 'gallery-accordion-billing-panel',
            triggerId: 'gallery-accordion-billing-trigger',
          })}
        >
          Invoices remain available after checkout.
        </div>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native button activation opens an item; group keyboard maps are primitive-owned',
      })}
    </section>
  );
}

export function AvatarDemo(): string {
  const loading = {
    src: '/avatars/ada.png',
    status: 'loading' as const,
  };
  const loaded = {
    src: '/avatars/grace.png',
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
      <div {...avatarRootAttributes({ ...loading, label: 'Ada Lovelace avatar' })}>
        <img
          {...avatarImageAttributes({
            ...loading,
            alt: 'Ada Lovelace',
            loading: 'lazy',
            sizes: '40px',
            srcSet: '/avatars/ada@2x.png 2x',
          })}
        />
        <span {...avatarFallbackAttributes({ ...loading, delayMs: 250 })}>AL</span>
      </div>
      <div {...avatarRootAttributes({ ...loaded, label: 'Grace Hopper avatar' })}>
        <img {...avatarImageAttributes({ ...loaded, alt: 'Grace Hopper' })} />
        <span {...avatarFallbackAttributes(loaded)}>GH</span>
      </div>
      <div {...avatarRootAttributes({ ...error, label: 'Fallback avatar' })}>
        <img {...avatarImageAttributes({ ...error, alt: '' })} />
        <span {...avatarFallbackAttributes(error)}>?</span>
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
    <section {...alertDialogRootAttributes(state)} data-gallery-demo="alert-dialog">
      <p data-demo-summary="no-js">
        Alert dialog keeps destructive confirmation controls wired to a native dialog element.
      </p>
      <button {...alertDialogTriggerAttributes({ ...state, open: false })}>Delete project</button>
      <dialog {...alertDialogContentAttributes(state)}>
        <h2 id="gallery-alert-dialog-title">Delete production project?</h2>
        <p id="gallery-alert-dialog-description">
          This action removes deploy tokens and cannot be undone.
        </p>
        <button {...alertDialogCancelAttributes({ ...state, autoFocus: true })}>Cancel</button>
        <button {...alertDialogActionAttributes({ ...state, intent: 'destructive' })}>
          Delete
        </button>
      </dialog>
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
        Autocomplete keeps a native input and datalist pair for form submission and browser
        suggestions.
      </p>
      <label id="gallery-autocomplete-label" for="gallery-autocomplete-input">
        Plan search
      </label>
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
      <div data-ui-demo="button">
        {Button.definition.render({ children: 'Save changes' })}
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
      <div data-ui-demo="checkbox">
        <span data-fixture-state="checked">
          {Checkbox.definition.render({
            checked: true,
            children: 'Accept terms',
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
    highlightedValue: 'invite',
    inputValue: '',
    items,
    open: true,
    placeholder: 'Type a command',
    value: 'invite',
  };

  return (
    <section data-gallery-demo="command">
      <p data-demo-summary="no-js">
        Command keeps a native dialog invoker with combobox/listbox semantics for command search.
      </p>
      <div data-ui-demo="command">
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
        changeReasons: 'trigger-context-menu, keyboard-open, item-click, escape-key, programmatic',
        dataState: 'open, closed, highlighted, disabled',
        keyboard: 'Context menu key or Shift+F10 opens; Arrow keys move over menu items',
      })}
    </section>
  );
}

export function DialogDemo(): string {
  const root = dialogRootAttributes({ open: true });
  const trigger = dialogTriggerAttributes({
    contentId: 'gallery-dialog-content',
    open: false,
  });
  const content = dialogContentAttributes({
    contentId: 'gallery-dialog-content',
    descriptionId: 'gallery-dialog-description',
    open: true,
    titleId: 'gallery-dialog-title',
  });
  const close = dialogCloseAttributes({
    contentId: 'gallery-dialog-content',
    open: true,
  });

  return (
    <section {...root} data-gallery-demo="dialog">
      <p data-demo-summary="no-js">
        Native dialog invoker commands keep the open and close controls meaningful without client
        JavaScript.
      </p>
      <button {...trigger}>Open preview</button>
      <dialog {...content}>
        <h2 id="gallery-dialog-title">Publish gallery changes</h2>
        <p id="gallery-dialog-description">Review the demo route before publishing.</p>
        <button {...close}>Close</button>
      </dialog>
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
        changeReasons: 'trigger-click, arrow-key, item-click, escape-key, typeahead, programmatic',
        dataState: 'open, closed, highlighted, disabled',
        keyboard: 'Arrow keys open and move over menu items; Escape closes the menu',
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
                  '<option value="starter">Starter</option><option value="team" selected>Team</option>',
                descriptionId: 'gallery-field-plan-description',
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
          id: 'gallery-fieldset',
          invalid: true,
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
  return (
    <section data-gallery-demo="kbd">
      <p data-demo-summary="no-js">
        Keyboard hints remain semantic kbd elements and do not require behavior wiring.
      </p>
      <div data-ui-demo="kbd">
        {Kbd.definition.render({ children: 'Ctrl' })}
        {Kbd.definition.render({ children: 'K', class: 'uppercase' })}
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
        keyboard: 'Arrow keys move across navigation items; Enter activates links or triggers',
      })}
    </section>
  );
}

export function MeterDemo(): string {
  const optimum = meterRootAttributes({
    high: 90,
    low: 50,
    max: 100,
    min: 0,
    optimum: 80,
    value: 84,
    valueText: '84 percent quality score',
  });
  const suboptimum = meterRootAttributes({ high: 90, low: 50, max: 100, optimum: 80, value: 42 });

  return (
    <section data-gallery-demo="meter">
      <p data-demo-summary="no-js">
        Meter uses the native meter element and exposes threshold data for styling.
      </p>
      <meter {...optimum}>84%</meter>
      <meter {...suboptimum}>42%</meter>
      {renderBehaviorContract({
        changeReasons: 'value comes from app state',
        dataState: 'optimum, suboptimum, even-less-good',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function NumberFieldDemo(): string {
  const quantity = {
    invalid: true,
    max: 10,
    min: 0,
    name: 'gallery-quantity',
    required: true,
    step: 2,
    value: 2,
  };

  return (
    <section data-gallery-demo="number-field">
      <p data-demo-summary="no-js">
        Number field preserves a native number input while step buttons expose primitive-owned
        actions.
      </p>
      <label id="gallery-number-field-label" for="gallery-number-field-input">
        Quantity
      </label>
      <div data-ui-demo="number-field">
        {NumberField.definition.render({
          ...quantity,
          children: (
            <>
              {NumberFieldControl.definition.render({
                ...quantity,
                children: (
                  <>
                    {NumberFieldDecrement.definition.render({
                      ...quantity,
                      id: 'gallery-number-field-decrement',
                      inputId: 'gallery-number-field-input',
                      label: 'Decrease quantity',
                    })}
                    {NumberFieldInput.definition.render({
                      ...quantity,
                      descriptionId: 'gallery-number-field-description',
                      errorId: 'gallery-number-field-error',
                      id: 'gallery-number-field-input',
                      labelledBy: 'gallery-number-field-label',
                    })}
                    {NumberFieldIncrement.definition.render({
                      ...quantity,
                      id: 'gallery-number-field-increment',
                      inputId: 'gallery-number-field-input',
                      label: 'Increase quantity',
                    })}
                  </>
                ),
              })}
              <p id="gallery-number-field-description">Choose an even quantity.</p>
              <p id="gallery-number-field-error">Quantity must be available in stock.</p>
            </>
          ),
          id: 'gallery-number-field',
        })}
        <span data-fixture-state="disabled-boundary">
          {NumberFieldDecrement.definition.render({
            min: 0,
            value: 0,
          })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, increment, decrement, programmatic',
        dataState: 'invalid, required, disabled',
        keyboard: 'Native number input keyboard plus primitive step buttons',
      })}
    </section>
  );
}

export function OtpFieldDemo(): string {
  const state = {
    descriptionId: 'gallery-otp-description',
    errorId: 'gallery-otp-error',
    invalid: true,
    labelledBy: 'gallery-otp-label',
    length: 6,
    name: 'gallery-otp-code',
    pattern: '[0-9]*',
    required: true,
    value: '1234',
  };
  const completeDisabledState = {
    disabled: true,
    length: 4,
    value: '9876',
  };

  return (
    <section data-gallery-demo="otp-field">
      <p data-demo-summary="no-js">
        OTP field submits one aggregate native input while visible slots keep per-character editing
        semantics.
      </p>
      <label id="gallery-otp-label" for="gallery-otp-code">
        One-time code
      </label>
      <div data-ui-demo="otp-field">
        {OtpField.definition.render({
          ...state,
          children: (
            <>
              {OtpFieldHiddenInput.definition.render({ ...state, id: 'gallery-otp-code' })}
              {OtpFieldGroup.definition.render({
                children: Array.from({ length: state.length }, (_, slotIndex) =>
                  OtpFieldInput.definition.render({
                    ...state,
                    id: `gallery-otp-slot-${slotIndex + 1}`,
                    label: `One-time code digit ${slotIndex + 1}`,
                    slotIndex,
                  }),
                ).join(''),
              })}
              <p id="gallery-otp-description">Enter the six digit verification code.</p>
              <p id="gallery-otp-error">The code is incomplete.</p>
            </>
          ),
          id: 'gallery-otp-field',
        })}
        <span data-fixture-state="disabled-complete">
          {OtpField.definition.render({
            ...completeDisabledState,
            children: OtpFieldHiddenInput.definition.render({
              ...completeDisabledState,
              id: 'gallery-otp-disabled-code',
              name: 'gallery-disabled-otp-code',
            }),
          })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, delete, paste, programmatic',
        dataState: 'invalid, required, complete, disabled',
        keyboard: 'Arrow keys, Home, and End move between visible slots',
      })}
    </section>
  );
}

export function ToggleDemo(): string {
  return (
    <section data-gallery-demo="toggle">
      <p data-demo-summary="no-js">
        Toggle renders a native button with aria-pressed, so the state is inspectable in HTML.
      </p>
      <div aria-label="Toggle states" data-ui-demo="toggle" role="group">
        <span data-fixture-state="pressed">
          {Toggle.definition.render({ children: 'Saved', pressed: true })}
        </span>
        <span data-fixture-state="idle">
          {Toggle.definition.render({ children: 'Save view', pressed: false, variant: 'subtle' })}
        </span>
        <span data-fixture-state="disabled">
          {Toggle.definition.render({ children: 'Disabled', disabled: true })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'pressed, off, disabled',
        keyboard: 'Space or Enter activates the native button',
      })}
    </section>
  );
}

export function ToggleGroupDemo(): string {
  const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'strike' }];
  const state = {
    activeValue: 'bold',
    items,
    type: 'multiple' as const,
    value: ['bold'] as const,
  };

  return (
    <section data-gallery-demo="toggle-group">
      <p data-demo-summary="no-js">
        Toggle group keeps formatting controls as native pressed buttons with roving tabindex.
      </p>
      <h2 id="gallery-toggle-group-label">Formatting</h2>
      <p id="gallery-toggle-group-description">Choose one or more text styles.</p>
      <div data-ui-demo="toggle-group">
        {ToggleGroup.definition.render({
          ...state,
          children: items
            .map((item) =>
              ToggleGroupItem.definition.render({
                ...state,
                children: ToggleGroupButton.definition.render({
                  ...state,
                  children: item.value,
                  id: `gallery-toggle-group-${item.value}`,
                  itemValue: item.value,
                }),
                id: `gallery-toggle-group-${item.value}-item`,
                itemValue: item.value,
              }),
            )
            .join(''),
          descriptionId: 'gallery-toggle-group-description',
          labelledBy: 'gallery-toggle-group-label',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'pressed, off, disabled',
        keyboard: 'Arrow keys move focus over enabled toggle buttons',
      })}
    </section>
  );
}

export function ToolbarDemo(): string {
  const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'link' }];
  const state = {
    activeValue: 'bold',
    items,
  };

  return (
    <section data-gallery-demo="toolbar">
      <p data-demo-summary="no-js">
        Toolbar keeps formatting commands as native buttons with toolbar semantics and roving
        tabindex.
      </p>
      <h2 id="gallery-toolbar-label">Formatting</h2>
      <p id="gallery-toolbar-description">
        Move between editor commands without leaving the group.
      </p>
      <div data-ui-demo="toolbar">
        {Toolbar.definition.render({
          ...state,
          children: items
            .map((item) =>
              ToolbarItem.definition.render({
                ...state,
                children: ToolbarButton.definition.render({
                  ...state,
                  children: item.value,
                  id: `gallery-toolbar-${item.value}`,
                  itemValue: item.value,
                  pressed: item.value === 'bold',
                }),
                id: `gallery-toolbar-${item.value}-item`,
                itemValue: item.value,
              }),
            )
            .join(''),
          descriptionId: 'gallery-toolbar-description',
          labelledBy: 'gallery-toolbar-label',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'button-click, keyboard, programmatic',
        dataState: 'pressed, unpressed, disabled',
        keyboard: 'Arrow keys move focus over enabled toolbar buttons',
      })}
    </section>
  );
}

export function RadioGroupDemo(): string {
  const items = [{ value: 'standard' }, { value: 'express' }, { disabled: true, value: 'freight' }];
  const state = {
    descriptionId: 'gallery-radio-description',
    items,
    name: 'gallery-shipping-speed',
    required: true,
    value: 'express',
  };

  return (
    <section data-gallery-demo="radio-group">
      <p data-demo-summary="no-js">
        Radio group keeps native radio inputs while adding roving-focus attributes.
      </p>
      {RadioGroup.definition.render({
        ...state,
        children: (
          <>
            <p id="gallery-radio-description">Choose a fulfillment speed.</p>
            {items.map((item) =>
              RadioGroupItem.definition.render({
                ...state,
                children: (
                  <>
                    {RadioGroupRadio.definition.render({
                      ...state,
                      controlId: `gallery-radio-${item.value}`,
                      itemValue: item.value,
                    })}
                    {RadioGroupLabel.definition.render({
                      ...state,
                      children: item.value,
                      controlId: `gallery-radio-${item.value}`,
                      itemValue: item.value,
                    })}
                  </>
                ),
                itemValue: item.value,
              }),
            )}
          </>
        ),
      })}
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'checked, unchecked, disabled',
        keyboard: 'Arrow keys move over enabled radio items',
      })}
    </section>
  );
}

export function ScrollAreaDemo(): string {
  const state = {
    dir: 'ltr' as const,
    scrollbars: 'both' as const,
  };
  const disabledState = {
    disabled: true,
    scrollbars: 'vertical' as const,
  };

  return (
    <section data-gallery-demo="scroll-area">
      <p data-demo-summary="no-js">
        Scroll area leaves movement on a native focusable viewport while exposing decorative
        scrollbar parts for styling.
      </p>
      <h2 id="gallery-scroll-area-title">Activity feed</h2>
      <div data-ui-demo="scroll-area">
        {ScrollArea.definition.render({
          ...state,
          children: (
            <>
              {ScrollAreaViewport.definition.render({
                ...state,
                children: (
                  <ol>
                    <li>Design tokens published.</li>
                    <li>Headless primitive verified.</li>
                    <li>Gallery route added.</li>
                  </ol>
                ),
                descriptionId: 'gallery-scroll-area-description',
                id: 'gallery-scroll-area-viewport',
                labelledBy: 'gallery-scroll-area-title',
                scrollX: 'none',
                scrollY: 'start',
              })}
              <p id="gallery-scroll-area-description">
                The viewport remains tabbable without a client behavior island.
              </p>
              {ScrollAreaScrollbar.definition.render({
                ...state,
                children: ScrollAreaThumb.definition.render({
                  ...state,
                  id: 'gallery-scroll-area-thumb-y',
                  orientation: 'vertical',
                  scrollPosition: 'start',
                  visible: true,
                }),
                id: 'gallery-scroll-area-scrollbar-y',
                orientation: 'vertical',
                visible: true,
              })}
              {ScrollAreaScrollbar.definition.render({
                ...state,
                children: ScrollAreaThumb.definition.render({
                  ...state,
                  forceMount: true,
                  id: 'gallery-scroll-area-thumb-x',
                  orientation: 'horizontal',
                  scrollPosition: 'none',
                  visible: false,
                }),
                forceMount: true,
                id: 'gallery-scroll-area-scrollbar-x',
                orientation: 'horizontal',
                visible: false,
              })}
              {ScrollAreaCorner.definition.render({
                ...state,
                id: 'gallery-scroll-area-corner',
              })}
            </>
          ),
          id: 'gallery-scroll-area',
        })}
        <span data-fixture-state="disabled">
          {ScrollArea.definition.render({
            ...disabledState,
            children: ScrollAreaViewport.definition.render({
              ...disabledState,
              children: 'Archived feed',
              label: 'Archived feed',
            }),
          })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'native scroll position changes',
        dataState: 'visible, hidden, disabled',
        keyboard: 'Native viewport scrolling and focus behavior',
      })}
    </section>
  );
}

export function SelectDemo(): string {
  const items = [
    { label: 'Starter', value: 'starter' },
    { label: 'Growth', value: 'growth' },
    { disabled: true, label: 'Enterprise', value: 'enterprise' },
  ];
  const state = {
    items,
    name: 'gallery-plan',
    required: true,
    value: 'growth',
  };

  return (
    <section data-gallery-demo="select">
      <p data-demo-summary="no-js">
        Select keeps a real select control and option list for no-JS form submission.
      </p>
      <label id="gallery-select-label" for="gallery-select">
        Plan
      </label>
      <div data-ui-demo="select">
        {Select.definition.render({
          ...state,
          children: (
            <>
              {SelectTrigger.definition.render({
                ...state,
                children: SelectContent.definition.render({
                  ...state,
                  children: items
                    .map((item) =>
                      SelectItem.definition.render({
                        ...state,
                        itemLabel: item.label,
                        itemValue: item.value,
                      }),
                    )
                    .join(''),
                  label: 'Plans',
                  labelledBy: 'gallery-select-label',
                }),
                id: 'gallery-select',
                labelledBy: 'gallery-select-label',
              })}
              {SelectValue.definition.render({ ...state, id: 'gallery-select-value' })}
            </>
          ),
          id: 'gallery-select-root',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-change, programmatic',
        dataState: 'open, closed, checked, unchecked, disabled',
        keyboard: 'Native select keyboard behavior',
      })}
    </section>
  );
}

export function SeparatorDemo(): string {
  return (
    <section data-gallery-demo="separator">
      <p data-demo-summary="no-js">
        Separator emits decorative and semantic separator variants with orientation data.
      </p>
      <hr {...separatorRootAttributes()} data-fixture-state="decorative" />
      <div
        {...separatorRootAttributes({ decorative: false, orientation: 'vertical' })}
        data-fixture-state="semantic"
      />
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'orientation only',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function SheetDemo(): string {
  return (
    <section data-gallery-demo="sheet">
      <p data-demo-summary="no-js">
        Sheet is a styled dialog wrapper that keeps native invoker commands and dialog content.
      </p>
      <div data-ui-demo="sheet">
        {Sheet.definition.render({
          children: 'Adjust notification and access settings.',
          contentId: 'gallery-sheet',
          description: 'Manage account preferences',
          open: true,
          side: 'right',
          title: 'Account settings',
          trigger: 'Open settings',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function DrawerDemo(): string {
  return (
    <section data-gallery-demo="drawer">
      <p data-demo-summary="no-js">
        Drawer is a styled dialog variant with bottom sheet placement and native close wiring.
      </p>
      <div data-ui-demo="drawer">
        {Drawer.definition.render({
          children: 'Review mobile actions before continuing.',
          contentId: 'gallery-drawer',
          description: 'Mobile action drawer',
          open: true,
          title: 'Quick actions',
          trigger: 'Open drawer',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function SkeletonDemo(): string {
  return (
    <section data-gallery-demo="skeleton">
      <p data-demo-summary="no-js">
        Skeleton is decorative loading markup hidden from assistive technology.
      </p>
      <div data-ui-demo="skeleton">
        {Skeleton.definition.render({ class: 'h-4 w-40' })}
        {Skeleton.definition.render({ class: 'h-20 w-full' })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function SliderDemo(): string {
  const state = {
    invalid: true,
    max: 100,
    min: 0,
    name: 'gallery-coverage',
    required: true,
    step: 5,
    value: 65,
  };

  return (
    <section data-gallery-demo="slider">
      <p data-demo-summary="no-js">
        Slider keeps a native range input for keyboard, form, and validation behavior while exposing
        decorative track parts.
      </p>
      <label id="gallery-slider-label" for="gallery-slider-input">
        Coverage
      </label>
      <div data-ui-demo="slider">
        {Slider.definition.render({
          ...state,
          children: (
            <>
              {SliderInput.definition.render({
                ...state,
                descriptionId: 'gallery-slider-description',
                errorId: 'gallery-slider-error',
                id: 'gallery-slider-input',
                labelledBy: 'gallery-slider-label',
                valueText: '65 percent coverage',
              })}
              {SliderTrack.definition.render({
                ...state,
                children: SliderRange.definition.render(state),
              })}
              {SliderThumb.definition.render(state)}
              <p id="gallery-slider-description">Choose a release coverage target.</p>
              <p id="gallery-slider-error">Coverage must be reviewed.</p>
            </>
          ),
          id: 'gallery-slider',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, programmatic',
        dataState: 'horizontal, vertical, invalid, required, disabled',
        keyboard: 'Native range input keyboard behavior',
      })}
    </section>
  );
}

export function SwitchDemo(): string {
  return (
    <section data-gallery-demo="switch">
      <p data-demo-summary="no-js">Switch renders a native checkbox with switch semantics.</p>
      <div data-ui-demo="switch">
        <span data-fixture-state="checked">
          {Switch.definition.render({
            checked: true,
            children: 'Notifications',
            name: 'gallery-notifications',
            value: 'enabled',
          })}
        </span>
        <span data-fixture-state="disabled">
          {Switch.definition.render({
            checked: false,
            children: 'Locked automation',
            disabled: true,
          })}
        </span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'checked, unchecked, disabled',
        keyboard: 'Space toggles the native checkbox',
      })}
    </section>
  );
}

export function TableDemo(): string {
  const header = TableHead.definition.render({
    children: TableRow.definition.render({
      children: `${TableHeaderCell.definition.render({
        children: 'Invoice',
      })}${TableHeaderCell.definition.render({
        children: 'Status',
      })}${TableHeaderCell.definition.render({
        children: 'Amount',
      })}`,
    }),
  });
  const body = TableBody.definition.render({
    children: `${TableRow.definition.render({
      children: `${TableHeaderCell.definition.render({
        children: 'INV-0042',
        scope: 'row',
      })}${TableCell.definition.render({
        children: 'Paid',
      })}${TableCell.definition.render({
        children: '$250.00',
      })}`,
    })}${TableRow.definition.render({
      children: TableCell.definition.render({
        children: 'Two pending invoices omitted',
        colSpan: 3,
      }),
    })}`,
  });

  return (
    <section data-gallery-demo="table">
      <p data-demo-summary="no-js">
        Table keeps semantic table sections, row headers, captions, and colspan output in authored
        TSX.
      </p>
      <div data-ui-demo="table">
        {Table.definition.render({
          caption: 'Invoices for the current billing period',
          children: `${header}${body}`,
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'Native table navigation semantics',
      })}
    </section>
  );
}

export function TabsDemo(): string {
  const items = [{ value: 'overview' }, { value: 'activity' }, { disabled: true, value: 'audit' }];
  const state = {
    activeValue: 'overview',
    items,
    orientation: 'horizontal' as const,
    value: 'overview',
  };

  return (
    <section {...tabsRootAttributes(state)} data-gallery-demo="tabs">
      <p data-demo-summary="no-js">
        Tabs expose tablist, tab, and tabpanel roles with roving focus data.
      </p>
      <div data-ui-demo="tabs">
        {Tabs.definition.render({
          ...state,
          children: `${TabsList.definition.render({
            ...state,
            children: items
              .map((item) =>
                TabsTrigger.definition.render({
                  ...state,
                  children: item.value,
                  id: `gallery-tabs-${item.value}`,
                  itemValue: item.value,
                  panelId: `gallery-tabs-${item.value}-panel`,
                }),
              )
              .join(''),
            label: 'Gallery tabs',
          })}${items
            .map((item) =>
              TabsPanel.definition.render({
                ...state,
                children: `${item.value} content`,
                id: `gallery-tabs-${item.value}-panel`,
                itemValue: item.value,
                triggerId: `gallery-tabs-${item.value}`,
              }),
            )
            .join('')}`,
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, keyboard, programmatic',
        dataState: 'active, inactive, disabled',
        keyboard: 'Arrow keys move focus; activation mode controls selection',
      })}
    </section>
  );
}

export function ToastDemo(): string {
  const toast = Toast.definition.render({
    children: (
      <>
        {ToastTitle.definition.render({
          children: 'Deployment complete',
          id: 'gallery-toast-title',
        })}
        {ToastDescription.definition.render({
          children: 'Production is serving the new build.',
          id: 'gallery-toast-description',
        })}
        {ToastAction.definition.render({
          actionValue: 'open-deploy',
          children: 'View deploy',
          id: 'gallery-toast',
        })}
        {ToastClose.definition.render({ children: 'Dismiss', id: 'gallery-toast' })}
      </>
    ),
    descriptionId: 'gallery-toast-description',
    id: 'gallery-toast',
    titleId: 'gallery-toast-title',
    variant: 'success',
  });

  return (
    <section data-gallery-demo="toast">
      <p data-demo-summary="no-js">
        Toast exposes a live-region viewport and dismiss/action buttons with inspectable state.
      </p>
      <div data-ui-demo="toast">
        {ToastViewport.definition.render({
          children: `${toast}${Toast.definition.render({
            id: 'gallery-toast-hidden',
            open: false,
            politeness: 'assertive',
            variant: 'error',
          })}`,
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
          placement: 'top-center',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'action-click, close-click, escape-key, timeout, programmatic',
        dataState: 'open, closed, disabled, variant',
        keyboard: 'Escape dismisses the active toast',
      })}
    </section>
  );
}

export function PopoverDemo(): string {
  const state = {
    contentId: 'gallery-popover-content',
    open: true,
  };

  return (
    <section data-gallery-demo="popover">
      <p data-demo-summary="no-js">
        Popover keeps native popover target wiring on the trigger and an auto popover content node.
      </p>
      {Popover.definition.render({
        children:
          PopoverTrigger.definition.render({ ...state, children: 'Filters' }) +
          PopoverContent.definition.render({
            ...state,
            children: 'Status, owner, and due-date filters are available.',
          }),
        id: 'gallery-popover',
        open: state.open,
      })}
      {renderBehaviorContract({
        changeReasons: 'trigger-click, escape-key, native-beforetoggle, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native popover trigger toggles content; Escape closes the popover',
      })}
    </section>
  );
}

export function ProgressDemo(): string {
  const loading = progressRootAttributes({
    max: 100,
    value: 42,
    valueText: '42 of 100 tasks complete',
  });
  const complete = progressRootAttributes({ max: 100, value: 100 });
  const indeterminate = progressRootAttributes({ max: 100, value: null });

  return (
    <section data-gallery-demo="progress">
      <p data-demo-summary="no-js">
        Progress uses the native progress element for determinate and indeterminate states.
      </p>
      <progress {...loading}>42%</progress>
      <progress {...complete}>100%</progress>
      <progress {...indeterminate}>Loading</progress>
      {renderBehaviorContract({
        changeReasons: 'value comes from app state',
        dataState: 'loading, complete, indeterminate',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function TooltipDemo(): string {
  const state = {
    contentId: 'gallery-tooltip-content',
    open: true,
  };

  return (
    <section {...tooltipRootAttributes(state)} data-gallery-demo="tooltip">
      <p data-demo-summary="no-js">
        Tooltip uses package-prefixed behavior attributes and a manual popover content node.
      </p>
      <button {...tooltipTriggerAttributes(state)}>Inspect status</button>
      <div {...tooltipContentAttributes(state)}>Status updates every minute.</div>
      {renderBehaviorContract({
        changeReasons:
          'trigger-pointer-enter, trigger-pointer-leave, trigger-focus, trigger-blur, escape-key, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape closes an open tooltip',
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
