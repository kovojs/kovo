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
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
  meterRootAttributes,
  numberFieldDecrementAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
  progressRootAttributes,
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
  selectContentAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  selectValueText,
  separatorRootAttributes,
  tabsRootAttributes,
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';
import {
  Alert,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  Card,
  Checkbox,
  Drawer,
  Kbd,
  Sheet,
  Skeleton,
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
} from '@jiso/ui';

export type GalleryComponent =
  | 'accordion'
  | 'alert'
  | 'alert-dialog'
  | 'avatar'
  | 'badge'
  | 'breadcrumb'
  | 'button'
  | 'card'
  | 'checkbox'
  | 'dialog'
  | 'drawer'
  | 'field'
  | 'kbd'
  | 'meter'
  | 'number-field'
  | 'otp-field'
  | 'progress'
  | 'radio-group'
  | 'scroll-area'
  | 'select'
  | 'separator'
  | 'sheet'
  | 'skeleton'
  | 'switch'
  | 'table'
  | 'tabs'
  | 'toggle'
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
    component: 'dialog',
    path: '/components/dialog',
    render: () => DialogDemo(),
    title: 'Dialog',
  },
  {
    component: 'drawer',
    path: '/components/drawer',
    render: () => DrawerDemo(),
    title: 'Drawer',
  },
  {
    component: 'field',
    path: '/components/field',
    render: () => FieldDemo(),
    title: 'Field',
  },
  {
    component: 'kbd',
    path: '/components/kbd',
    render: () => KbdDemo(),
    title: 'Kbd',
  },
  {
    component: 'meter',
    path: '/components/meter',
    render: () => MeterDemo(),
    title: 'Meter',
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
    component: 'toggle',
    path: '/components/toggle',
    render: () => ToggleDemo(),
    title: 'Toggle',
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

export function FieldDemo(): string {
  const fieldState = {
    invalid: true,
    required: true,
  };
  const fieldsetState = {
    descriptionId: 'gallery-fieldset-description',
    id: 'gallery-fieldset',
    invalid: true,
  };

  return (
    <section data-gallery-demo="field">
      <p data-demo-summary="no-js">
        Field helpers wire labels, descriptions, errors, and native controls without hidden inputs.
      </p>
      <div {...fieldRootAttributes({ ...fieldState, id: 'gallery-field' })}>
        <label
          {...fieldLabelAttributes({
            ...fieldState,
            controlId: 'gallery-field-email',
            id: 'gallery-field-label',
          })}
        >
          Email
        </label>
        <input
          {...fieldControlAttributes({
            ...fieldState,
            descriptionId: 'gallery-field-description',
            errorId: 'gallery-field-error',
            id: 'gallery-field-email',
            name: 'email',
          })}
          type="email"
        />
        <p {...fieldDescriptionAttributes({ id: 'gallery-field-description' })}>
          Used for release notifications.
        </p>
        <p {...fieldErrorAttributes({ id: 'gallery-field-error' })}>Email is required.</p>
      </div>
      <fieldset {...fieldsetRootAttributes(fieldsetState)}>
        <legend {...fieldsetLegendAttributes({ id: 'gallery-fieldset-legend' })}>Plan</legend>
        <p {...fieldDescriptionAttributes({ id: 'gallery-fieldset-description' })}>
          Fieldset preserves the native grouping element.
        </p>
      </fieldset>
      {renderBehaviorContract({
        changeReasons: 'native form control changes',
        dataState: 'invalid, required, disabled',
        keyboard: 'Native field and fieldset semantics',
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
    <section
      {...numberFieldRootAttributes({ ...quantity, id: 'gallery-number-field' })}
      data-gallery-demo="number-field"
    >
      <p data-demo-summary="no-js">
        Number field preserves a native number input while step buttons expose primitive-owned
        actions.
      </p>
      <label id="gallery-number-field-label" for="gallery-number-field-input">
        Quantity
      </label>
      <div>
        <button
          {...numberFieldDecrementAttributes({
            ...quantity,
            id: 'gallery-number-field-decrement',
            inputId: 'gallery-number-field-input',
            label: 'Decrease quantity',
          })}
        >
          -
        </button>
        <input
          {...numberFieldInputAttributes({
            ...quantity,
            descriptionId: 'gallery-number-field-description',
            errorId: 'gallery-number-field-error',
            id: 'gallery-number-field-input',
            labelledBy: 'gallery-number-field-label',
          })}
        />
        <button
          {...numberFieldIncrementAttributes({
            ...quantity,
            id: 'gallery-number-field-increment',
            inputId: 'gallery-number-field-input',
            label: 'Increase quantity',
          })}
        >
          +
        </button>
      </div>
      <p id="gallery-number-field-description">Choose an even quantity.</p>
      <p id="gallery-number-field-error">Quantity must be available in stock.</p>
      <button
        {...numberFieldDecrementAttributes({
          min: 0,
          value: 0,
        })}
        data-fixture-state="disabled-boundary"
      >
        At minimum
      </button>
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
    <section
      {...otpFieldRootAttributes({ ...state, id: 'gallery-otp-field' })}
      data-gallery-demo="otp-field"
    >
      <p data-demo-summary="no-js">
        OTP field submits one aggregate native input while visible slots keep per-character editing
        semantics.
      </p>
      <label id="gallery-otp-label" for="gallery-otp-code">
        One-time code
      </label>
      <input {...otpFieldHiddenInputAttributes({ ...state, id: 'gallery-otp-code' })} />
      <div aria-label="One-time code slots">
        {Array.from({ length: state.length }, (_, slotIndex) => (
          <input
            {...otpFieldInputAttributes({
              ...state,
              id: `gallery-otp-slot-${slotIndex + 1}`,
              label: `One-time code digit ${slotIndex + 1}`,
              slotIndex,
            })}
          />
        ))}
      </div>
      <p id="gallery-otp-description">Enter the six digit verification code.</p>
      <p id="gallery-otp-error">The code is incomplete.</p>
      <div
        {...otpFieldRootAttributes(completeDisabledState)}
        data-fixture-state="disabled-complete"
      >
        <input
          {...otpFieldHiddenInputAttributes({
            ...completeDisabledState,
            id: 'gallery-otp-disabled-code',
            name: 'gallery-disabled-otp-code',
          })}
        />
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
      <div {...radioGroupRootAttributes(state)}>
        <p id="gallery-radio-description">Choose a fulfillment speed.</p>
        {items.map((item) => (
          <div
            {...radioGroupItemAttributes({
              ...state,
              itemValue: item.value,
            })}
          >
            <input
              {...radioGroupRadioAttributes({
                ...state,
                controlId: `gallery-radio-${item.value}`,
                itemValue: item.value,
              })}
            />
            <label
              {...radioGroupLabelAttributes({
                ...state,
                controlId: `gallery-radio-${item.value}`,
                itemValue: item.value,
              })}
            >
              {item.value}
            </label>
          </div>
        ))}
      </div>
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
    <section
      {...scrollAreaRootAttributes({ ...state, id: 'gallery-scroll-area' })}
      data-gallery-demo="scroll-area"
    >
      <p data-demo-summary="no-js">
        Scroll area leaves movement on a native focusable viewport while exposing decorative
        scrollbar parts for styling.
      </p>
      <h2 id="gallery-scroll-area-title">Activity feed</h2>
      <div
        {...scrollAreaViewportAttributes({
          ...state,
          descriptionId: 'gallery-scroll-area-description',
          id: 'gallery-scroll-area-viewport',
          labelledBy: 'gallery-scroll-area-title',
        })}
      >
        <ol>
          <li>Design tokens published.</li>
          <li>Headless primitive verified.</li>
          <li>Gallery route added.</li>
        </ol>
      </div>
      <p id="gallery-scroll-area-description">
        The viewport remains tabbable without a client behavior island.
      </p>
      <div
        {...scrollAreaScrollbarAttributes({
          ...state,
          id: 'gallery-scroll-area-scrollbar-y',
          orientation: 'vertical',
          visible: true,
        })}
      >
        <div
          {...scrollAreaThumbAttributes({
            ...state,
            id: 'gallery-scroll-area-thumb-y',
            orientation: 'vertical',
            visible: true,
          })}
        />
      </div>
      <div
        {...scrollAreaScrollbarAttributes({
          ...state,
          forceMount: true,
          id: 'gallery-scroll-area-scrollbar-x',
          orientation: 'horizontal',
          visible: false,
        })}
      >
        <div
          {...scrollAreaThumbAttributes({
            ...state,
            forceMount: true,
            id: 'gallery-scroll-area-thumb-x',
            orientation: 'horizontal',
            visible: false,
          })}
        />
      </div>
      <div {...scrollAreaCornerAttributes({ ...state, id: 'gallery-scroll-area-corner' })} />
      <div {...scrollAreaRootAttributes(disabledState)} data-fixture-state="disabled">
        <div {...scrollAreaViewportAttributes({ ...disabledState, label: 'Archived feed' })}>
          Archived feed
        </div>
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
    <section {...selectRootAttributes(state)} data-gallery-demo="select">
      <p data-demo-summary="no-js">
        Select keeps a real select control and option list for no-JS form submission.
      </p>
      <label id="gallery-select-label" for="gallery-select">
        Plan
      </label>
      <select
        {...selectTriggerAttributes({
          ...state,
          id: 'gallery-select',
          labelledBy: 'gallery-select-label',
        })}
      >
        <optgroup {...selectContentAttributes({ ...state, labelledBy: 'gallery-select-label' })}>
          {items.map((item) => (
            <option
              {...selectItemAttributes({
                ...state,
                itemLabel: item.label,
                itemValue: item.value,
              })}
            >
              {item.label}
            </option>
          ))}
        </optgroup>
      </select>
      <span {...selectValueAttributes(state)}>{selectValueText(state)}</span>
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
