/** @jsxImportSource @kovojs/server */
import { tabsRootAttributes } from '@kovojs/headless-ui/tabs';
import * as style from '@kovojs/style';
import { Drawer } from '@kovojs/ui/drawer';
import { Meter } from '@kovojs/ui/meter';
import {
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@kovojs/ui/number-field';
import { OtpField, OtpFieldGroup, OtpFieldHiddenInput, OtpFieldInput } from '@kovojs/ui/otp-field';
import { Popover, PopoverContent, PopoverTrigger } from '@kovojs/ui/popover';
import { Progress } from '@kovojs/ui/progress';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
} from '@kovojs/ui/radio-group';
import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@kovojs/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kovojs/ui/select';
import { Separator } from '@kovojs/ui/separator';
import { Sheet } from '@kovojs/ui/sheet';
import { Skeleton } from '@kovojs/ui/skeleton';
import { Slider, SliderInput, SliderRange, SliderThumb, SliderTrack } from '@kovojs/ui/slider';
import { Switch } from '@kovojs/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@kovojs/ui/table';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from '@kovojs/ui/tabs';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from '@kovojs/ui/toast';
import { ToggleGroup, ToggleGroupButton, ToggleGroupItem } from '@kovojs/ui/toggle-group';
import { Toggle } from '@kovojs/ui/toggle';
import { Toolbar, ToolbarButton, ToolbarItem } from '@kovojs/ui/toolbar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@kovojs/ui/tooltip';

export function MeterDemo(): string {
  return (
    <section data-gallery-demo="meter">
      <p data-demo-summary="no-js">
        Meter uses the native meter element and exposes threshold data for styling.
      </p>
      <div data-ui-demo="meter">
        {Meter.definition.render({
          children: '84%',
          high: 90,
          low: 50,
          max: 100,
          min: 0,
          optimum: 80,
          value: 84,
          valueText: '84 percent quality score',
        })}
        {Meter.definition.render({
          children: '42%',
          high: 90,
          low: 50,
          max: 100,
          optimum: 80,
          value: 42,
        })}
      </div>
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
                      form: 'gallery-number-field-form',
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
    form: 'gallery-otp-form',
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
      <form id="gallery-otp-form" data-gallery-form="otp-field" />
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
    errorId: 'gallery-radio-error',
    form: 'gallery-radio-form',
    invalid: true,
    items,
    labelledBy: 'gallery-radio-label',
    name: 'gallery-shipping-speed',
    required: true,
    value: 'express',
  };

  return (
    <section data-gallery-demo="radio-group">
      <form id="gallery-radio-form" data-gallery-form="radio-group" />
      <p data-demo-summary="no-js">
        Radio group keeps native radio inputs while adding roving-focus attributes.
      </p>
      <h2 hidden id="gallery-radio-label">
        Shipping speed
      </h2>
      <p hidden id="gallery-radio-error">
        Freight requires a quoted delivery window.
      </p>
      <div data-ui-demo="radio-group">
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
          id: 'gallery-radio-group',
        })}
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
    form: 'gallery-select-form',
    items,
    name: 'gallery-plan',
    required: true,
    value: 'growth',
  };

  return (
    <section data-gallery-demo="select">
      <p data-demo-summary="no-js">
        Select keeps a custom trigger and listbox paired with a hidden submitted input.
      </p>
      <form id="gallery-select-form" method="post" action="/gallery/select" />
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
              {SelectHiddenInput.definition.render({
                ...state,
                id: 'gallery-select-hidden',
              })}
              {SelectValue.definition.render({ ...state, id: 'gallery-select-value' })}
            </>
          ),
          id: 'gallery-select-root',
        })}
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, item-select, arrow-key, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, disabled',
        keyboard: 'Arrow keys, Home, End, and typeahead move over enabled options; Escape closes',
      })}
    </section>
  );
}

export function SeparatorDemo(): string {
  const separatorDemoStyles = style.create({
    short: {
      width: 256,
    },
  });

  return (
    <section data-gallery-demo="separator">
      <p data-demo-summary="no-js">
        Separator emits decorative and semantic separator variants with orientation data.
      </p>
      <div style="display:grid;gap:1rem" data-ui-demo="separator">
        <span data-fixture-state="decorative">
          {Separator.definition.render({ style: separatorDemoStyles.short })}
        </span>
        <span
          style="display:flex;height:4rem;align-items:stretch;gap:1rem"
          data-fixture-state="semantic"
        >
          <span>Before</span>
          {Separator.definition.render({ decorative: false, orientation: 'vertical' })}
          <span>After</span>
        </span>
      </div>
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
  // A content silhouette (circular avatar + two text lines) so the demo reads
  // as "a profile row is loading" instead of two anonymous gray blocks — the
  // shadcn skeleton card shape. The Skeleton component's own background/shimmer
  // comes from @kovojs/ui CSS; only the demo-local sizing/layout is inlined,
  // because app-authored style.create(...) atoms in demo files are not collected
  // by the build and would render as 0px.
  return (
    <section data-gallery-demo="skeleton">
      <p data-demo-summary="no-js">
        Skeleton is decorative loading markup hidden from assistive technology.
      </p>
      <div data-ui-demo="skeleton">
        <div style={{ alignItems: 'center', columnGap: 12, display: 'flex' }}>
          {Skeleton.definition.render({
            style: [null, { borderRadius: '50%', height: 48, width: 48 }],
          })}
          <div style={{ display: 'grid', rowGap: 8 }}>
            {Skeleton.definition.render({ style: [null, { height: 16, width: 220 }] })}
            {Skeleton.definition.render({ style: [null, { height: 16, width: 160 }] })}
          </div>
        </div>
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
    form: 'gallery-slider-form',
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
      <form id="gallery-slider-form" data-gallery-form="slider" />
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
      <form id="gallery-switch-form" data-gallery-form="switch" />
      <span hidden id="gallery-switch-help">
        Native switch input submitted through an external form owner.
      </span>
      <div data-ui-demo="switch">
        <span data-fixture-state="checked">
          {Switch.definition.render({
            checked: true,
            children: 'Notifications',
            describedBy: 'gallery-switch-help',
            form: 'gallery-switch-form',
            id: 'gallery-switch-notifications',
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
        keyboard: 'Arrow keys move focus; Enter or Space activates the focused tab in manual mode',
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
          variant: 'success',
        })}
        {ToastAction.definition.render({
          actionValue: 'keep-open',
          children: 'Keep open',
          dismissOnAction: false,
          id: 'gallery-toast',
          variant: 'success',
        })}
        {ToastAction.definition.render({
          actionValue: 'blocked',
          children: 'Blocked',
          disabled: true,
          dismissOnAction: false,
          id: 'gallery-toast',
          variant: 'success',
        })}
        {ToastClose.definition.render({
          id: 'gallery-toast',
          variant: 'success',
        })}
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
      <div data-ui-demo="popover">
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
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, escape-key, native-beforetoggle, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native popover trigger toggles content; Escape closes the popover',
      })}
    </section>
  );
}

export function ProgressDemo(): string {
  return (
    <section data-gallery-demo="progress">
      <p data-demo-summary="no-js">
        Progress uses the native progress element for determinate and indeterminate states.
      </p>
      <div data-ui-demo="progress">
        {Progress.definition.render({
          children: '42%',
          max: 100,
          value: 42,
          valueText: '42 of 100 tasks complete',
        })}
        {Progress.definition.render({ children: '100%', max: 100, value: 100 })}
        {Progress.definition.render({ children: 'Loading', max: 100, value: null })}
      </div>
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
    <section data-gallery-demo="tooltip">
      <p data-demo-summary="no-js">
        Tooltip uses package-prefixed behavior attributes and a hidden content node.
      </p>
      <div data-ui-demo="tooltip">
        {Tooltip.definition.render({
          children:
            TooltipTrigger.definition.render({ ...state, children: 'Inspect status' }) +
            TooltipContent.definition.render({
              ...state,
              children: 'Status updates every minute.',
            }),
          id: 'gallery-tooltip',
          open: state.open,
        })}
      </div>
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
