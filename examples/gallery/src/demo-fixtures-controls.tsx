/** @jsxImportSource @kovojs/server */
import { tabsRootAttributes } from '@kovojs/headless-ui/tabs';
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

export function MeterDemo() {
  return (
    <section data-gallery-demo="meter">
      <p data-demo-summary="no-js">
        Meter uses the native meter element and exposes threshold data for styling.
      </p>
      <div data-ui-demo="meter">
        {
          <Meter
            high={90}
            low={50}
            max={100}
            min={0}
            optimum={80}
            value={84}
            valueText={'84 percent quality score'}
          >
            {'84%'}
          </Meter>
        }
        {
          <Meter high={90} low={50} max={100} optimum={80} value={42}>
            {'42%'}
          </Meter>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'value comes from app state',
        dataState: 'optimum, suboptimum, even-less-good',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function NumberFieldDemo() {
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
        {
          <NumberField {...quantity} id={'gallery-number-field'}>
            {
              <>
                {
                  <NumberFieldControl {...quantity}>
                    {
                      <>
                        {
                          <NumberFieldDecrement
                            {...quantity}
                            id={'gallery-number-field-decrement'}
                            inputId={'gallery-number-field-input'}
                            label={'Decrease quantity'}
                          />
                        }
                        {
                          <NumberFieldInput
                            {...quantity}
                            descriptionId={'gallery-number-field-description'}
                            errorId={'gallery-number-field-error'}
                            form={'gallery-number-field-form'}
                            id={'gallery-number-field-input'}
                            labelledBy={'gallery-number-field-label'}
                          />
                        }
                        {
                          <NumberFieldIncrement
                            {...quantity}
                            id={'gallery-number-field-increment'}
                            inputId={'gallery-number-field-input'}
                            label={'Increase quantity'}
                          />
                        }
                      </>
                    }
                  </NumberFieldControl>
                }
                <p id="gallery-number-field-description">Choose an even quantity.</p>
                <p id="gallery-number-field-error">Quantity must be available in stock.</p>
              </>
            }
          </NumberField>
        }
        <span data-fixture-state="disabled-boundary">
          {<NumberFieldDecrement min={0} value={0} />}
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

export function OtpFieldDemo() {
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
        {
          <OtpField {...state} id={'gallery-otp-field'}>
            {
              <>
                {<OtpFieldHiddenInput {...state} id={'gallery-otp-code'} />}
                {
                  <OtpFieldGroup>
                    {Array.from({ length: state.length }, (_, slotIndex) => (
                      <OtpFieldInput
                        {...state}
                        id={`gallery-otp-slot-${slotIndex + 1}`}
                        label={`One-time code digit ${slotIndex + 1}`}
                        slotIndex={slotIndex}
                      />
                    ))}
                  </OtpFieldGroup>
                }
                <p id="gallery-otp-description">Enter the six digit verification code.</p>
                <p id="gallery-otp-error">The code is incomplete.</p>
              </>
            }
          </OtpField>
        }
        <span data-fixture-state="disabled-complete">
          {
            <OtpField {...completeDisabledState}>
              {
                <OtpFieldHiddenInput
                  {...completeDisabledState}
                  id={'gallery-otp-disabled-code'}
                  name={'gallery-disabled-otp-code'}
                />
              }
            </OtpField>
          }
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

export function ToggleDemo() {
  return (
    <section data-gallery-demo="toggle">
      <p data-demo-summary="no-js">
        Toggle renders a native button with aria-pressed, so the state is inspectable in HTML.
      </p>
      <div aria-label="Toggle states" data-ui-demo="toggle" role="group">
        <span data-fixture-state="pressed">{<Toggle pressed={true}>{'Saved'}</Toggle>}</span>
        <span data-fixture-state="idle">
          {
            <Toggle pressed={false} variant={'subtle'}>
              {'Save view'}
            </Toggle>
          }
        </span>
        <span data-fixture-state="disabled">{<Toggle disabled={true}>{'Disabled'}</Toggle>}</span>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'pressed, off, disabled',
        keyboard: 'Space or Enter activates the native button',
      })}
    </section>
  );
}

export function ToggleGroupDemo() {
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
        {
          <ToggleGroup
            {...state}
            descriptionId={'gallery-toggle-group-description'}
            labelledBy={'gallery-toggle-group-label'}
          >
            {items.map((item) => (
              <ToggleGroupItem
                {...state}
                id={`gallery-toggle-group-${item.value}-item`}
                itemValue={item.value}
              >
                {
                  <ToggleGroupButton
                    {...state}
                    id={`gallery-toggle-group-${item.value}`}
                    itemValue={item.value}
                  >
                    {item.value}
                  </ToggleGroupButton>
                }
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'pressed, off, disabled',
        keyboard: 'Arrow keys move focus over enabled toggle buttons',
      })}
    </section>
  );
}

export function ToolbarDemo() {
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
        {
          <Toolbar
            {...state}
            descriptionId={'gallery-toolbar-description'}
            labelledBy={'gallery-toolbar-label'}
          >
            {items.map((item) => (
              <ToolbarItem
                {...state}
                id={`gallery-toolbar-${item.value}-item`}
                itemValue={item.value}
              >
                {
                  <ToolbarButton
                    {...state}
                    id={`gallery-toolbar-${item.value}`}
                    itemValue={item.value}
                    pressed={item.value === 'bold'}
                  >
                    {item.value}
                  </ToolbarButton>
                }
              </ToolbarItem>
            ))}
          </Toolbar>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'button-click, keyboard, programmatic',
        dataState: 'pressed, unpressed, disabled',
        keyboard: 'Arrow keys move focus over enabled toolbar buttons',
      })}
    </section>
  );
}

export function RadioGroupDemo() {
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
        {
          <RadioGroup {...state} id={'gallery-radio-group'}>
            {
              <>
                <p id="gallery-radio-description">Choose a fulfillment speed.</p>
                {items.map((item) => (
                  <RadioGroupItem {...state} itemValue={item.value}>
                    {
                      <>
                        {
                          <RadioGroupRadio
                            {...state}
                            controlId={`gallery-radio-${item.value}`}
                            itemValue={item.value}
                          />
                        }
                        {
                          <RadioGroupLabel
                            {...state}
                            controlId={`gallery-radio-${item.value}`}
                            itemValue={item.value}
                          >
                            {item.value}
                          </RadioGroupLabel>
                        }
                      </>
                    }
                  </RadioGroupItem>
                ))}
              </>
            }
          </RadioGroup>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'checked, unchecked, disabled',
        keyboard: 'Arrow keys move over enabled radio items',
      })}
    </section>
  );
}

export function ScrollAreaDemo() {
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
        {
          <ScrollArea {...state} id={'gallery-scroll-area'}>
            {
              <>
                {
                  <ScrollAreaViewport
                    {...state}
                    descriptionId={'gallery-scroll-area-description'}
                    id={'gallery-scroll-area-viewport'}
                    labelledBy={'gallery-scroll-area-title'}
                    scrollX={'none'}
                    scrollY={'start'}
                  >
                    {
                      <ol>
                        <li>Design tokens published.</li>
                        <li>Headless primitive verified.</li>
                        <li>Gallery route added.</li>
                      </ol>
                    }
                  </ScrollAreaViewport>
                }
                <p id="gallery-scroll-area-description">
                  The viewport remains tabbable without a client behavior island.
                </p>
                {
                  <ScrollAreaScrollbar
                    {...state}
                    id={'gallery-scroll-area-scrollbar-y'}
                    orientation={'vertical'}
                    visible={true}
                  >
                    {
                      <ScrollAreaThumb
                        {...state}
                        id={'gallery-scroll-area-thumb-y'}
                        orientation={'vertical'}
                        scrollPosition={'start'}
                        visible={true}
                      />
                    }
                  </ScrollAreaScrollbar>
                }
                {
                  <ScrollAreaScrollbar
                    {...state}
                    forceMount={true}
                    id={'gallery-scroll-area-scrollbar-x'}
                    orientation={'horizontal'}
                    visible={false}
                  >
                    {
                      <ScrollAreaThumb
                        {...state}
                        forceMount={true}
                        id={'gallery-scroll-area-thumb-x'}
                        orientation={'horizontal'}
                        scrollPosition={'none'}
                        visible={false}
                      />
                    }
                  </ScrollAreaScrollbar>
                }
                {<ScrollAreaCorner {...state} id={'gallery-scroll-area-corner'} />}
              </>
            }
          </ScrollArea>
        }
        <span data-fixture-state="disabled">
          {
            <ScrollArea {...disabledState}>
              {
                <ScrollAreaViewport {...disabledState} label={'Archived feed'}>
                  {'Archived feed'}
                </ScrollAreaViewport>
              }
            </ScrollArea>
          }
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

export function SelectDemo() {
  const items = [
    { label: 'Starter', value: 'starter' },
    { label: 'Growth', value: 'growth' },
    { disabled: true, label: 'Enterprise', value: 'enterprise' },
  ];
  const state = {
    form: 'gallery-select-form',
    items,
    listboxId: 'gallery-select-listbox',
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
        {
          <Select {...state} id={'gallery-select-root'}>
            {
              <>
                {
                  <SelectTrigger
                    {...state}
                    id={'gallery-select'}
                    labelledBy={'gallery-select-label'}
                  >
                    {
                      <SelectContent
                        {...state}
                        id={'gallery-select-listbox'}
                        label={'Plans'}
                        labelledBy={'gallery-select-label'}
                      >
                        {items.map((item) => (
                          <SelectItem {...state} itemLabel={item.label} itemValue={item.value} />
                        ))}
                      </SelectContent>
                    }
                  </SelectTrigger>
                }
                {<SelectHiddenInput {...state} id={'gallery-select-hidden'} />}
                {<SelectValue {...state} id={'gallery-select-value'} />}
              </>
            }
          </Select>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, item-select, arrow-key, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, disabled',
        keyboard: 'Arrow keys, Home, End, and typeahead move over enabled options; Escape closes',
      })}
    </section>
  );
}

export function SeparatorDemo() {
  return (
    <section data-gallery-demo="separator">
      <p data-demo-summary="no-js">
        Separator emits decorative and semantic separator variants with orientation data.
      </p>
      <div style="display:grid;gap:1rem" data-ui-demo="separator">
        <span style="display:block;width:256px" data-fixture-state="decorative">
          {<Separator />}
        </span>
        <span
          style="display:flex;height:4rem;align-items:stretch;gap:1rem"
          data-fixture-state="semantic"
        >
          <span>Before</span>
          {<Separator decorative={false} orientation={'vertical'} />}
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

export function SheetDemo() {
  return (
    <section data-gallery-demo="sheet">
      <p data-demo-summary="no-js">
        Sheet is a styled dialog wrapper that keeps native invoker commands and dialog content.
      </p>
      <div data-ui-demo="sheet">
        {
          <Sheet
            contentId={'gallery-sheet'}
            description={'Manage account preferences'}
            open={true}
            side={'right'}
            title={'Account settings'}
            trigger={'Open settings'}
          >
            {'Adjust notification and access settings.'}
          </Sheet>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function DrawerDemo() {
  return (
    <section data-gallery-demo="drawer">
      <p data-demo-summary="no-js">
        Drawer is a styled dialog variant with bottom sheet placement and native close wiring.
      </p>
      <div data-ui-demo="drawer">
        {
          <Drawer
            contentId={'gallery-drawer'}
            description={'Mobile action drawer'}
            open={true}
            title={'Quick actions'}
            trigger={'Open drawer'}
          >
            {'Review mobile actions before continuing.'}
          </Drawer>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, close-click, cancel-event, native-beforetoggle',
        dataState: 'open, closed, disabled',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function SkeletonDemo() {
  // A content silhouette (circular avatar + two text lines) so the demo reads
  // as "a profile row is loading" instead of two anonymous gray blocks — the
  // shadcn skeleton card shape. The Skeleton component's own background/shimmer
  // comes from @kovojs/ui CSS; only the demo-local sizing/layout is inlined,
  // because app-authored atomic style atoms in demo files are not collected
  // by the build and would render as 0px.
  return (
    <section data-gallery-demo="skeleton">
      <p data-demo-summary="no-js">
        Skeleton is decorative loading markup hidden from assistive technology.
      </p>
      <div data-ui-demo="skeleton">
        <div style={{ alignItems: 'center', columnGap: 12, display: 'flex' }}>
          <span
            style={{
              borderRadius: '50%',
              display: 'block',
              height: 48,
              overflow: 'hidden',
              width: 48,
            }}
            data-demo-skeleton-shape="avatar"
          >
            {<Skeleton />}
          </span>
          <div style={{ display: 'grid', rowGap: 8 }}>
            <span
              style={{ display: 'block', height: 16, overflow: 'hidden', width: 220 }}
              data-demo-skeleton-shape="line"
            >
              {<Skeleton />}
            </span>
            <span
              style={{ display: 'block', height: 16, overflow: 'hidden', width: 160 }}
              data-demo-skeleton-shape="line"
            >
              {<Skeleton />}
            </span>
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

export function SliderDemo() {
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
        {
          <Slider {...state} id={'gallery-slider'}>
            {
              <>
                {
                  <SliderInput
                    {...state}
                    descriptionId={'gallery-slider-description'}
                    errorId={'gallery-slider-error'}
                    id={'gallery-slider-input'}
                    labelledBy={'gallery-slider-label'}
                    valueText={'65 percent coverage'}
                  />
                }
                {<SliderTrack {...state}>{<SliderRange {...state} />}</SliderTrack>}
                {<SliderThumb {...state} />}
                <p id="gallery-slider-description">Choose a release coverage target.</p>
                <p id="gallery-slider-error">Coverage must be reviewed.</p>
              </>
            }
          </Slider>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, programmatic',
        dataState: 'horizontal, vertical, invalid, required, disabled',
        keyboard: 'Native range input keyboard behavior',
      })}
    </section>
  );
}

export function SwitchDemo() {
  return (
    <section data-gallery-demo="switch">
      <p data-demo-summary="no-js">Switch renders a native checkbox with switch semantics.</p>
      <form id="gallery-switch-form" data-gallery-form="switch" />
      <span hidden id="gallery-switch-help">
        Native switch input submitted through an external form owner.
      </span>
      <div data-ui-demo="switch">
        <span data-fixture-state="checked">
          {
            <Switch
              checked={true}
              describedBy={'gallery-switch-help'}
              form={'gallery-switch-form'}
              id={'gallery-switch-notifications'}
              name={'gallery-notifications'}
              value={'enabled'}
            >
              {'Notifications'}
            </Switch>
          }
        </span>
        <span data-fixture-state="disabled">
          {
            <Switch checked={false} disabled={true}>
              {'Locked automation'}
            </Switch>
          }
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

export function TableDemo() {
  const header = (
    <TableHead>
      {
        <TableRow>
          {[
            <TableHeaderCell>{'Invoice'}</TableHeaderCell>,
            <TableHeaderCell>{'Status'}</TableHeaderCell>,
            <TableHeaderCell>{'Amount'}</TableHeaderCell>,
          ]}
        </TableRow>
      }
    </TableHead>
  );
  const body = (
    <TableBody>
      {[
        <TableRow>
          {[
            <TableHeaderCell scope={'row'}>{'INV-0042'}</TableHeaderCell>,
            <TableCell>{'Paid'}</TableCell>,
            <TableCell>{'$250.00'}</TableCell>,
          ]}
        </TableRow>,
        <TableRow>{<TableCell colSpan={3}>{'Two pending invoices omitted'}</TableCell>}</TableRow>,
      ]}
    </TableBody>
  );

  return (
    <section data-gallery-demo="table">
      <p data-demo-summary="no-js">
        Table keeps semantic table sections, row headers, captions, and colspan output in authored
        TSX.
      </p>
      <div data-ui-demo="table">
        {<Table caption={'Invoices for the current billing period'}>{[header, body]}</Table>}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'Native table navigation semantics',
      })}
    </section>
  );
}

export function TabsDemo() {
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
        {
          <Tabs {...state}>
            {[
              <TabsList {...state} label={'Gallery tabs'}>
                {items.map((item) => (
                  <TabsTrigger
                    {...state}
                    id={`gallery-tabs-${item.value}`}
                    itemValue={item.value}
                    panelId={`gallery-tabs-${item.value}-panel`}
                  >
                    {item.value}
                  </TabsTrigger>
                ))}
              </TabsList>,
              items.map((item) => (
                <TabsPanel
                  {...state}
                  id={`gallery-tabs-${item.value}-panel`}
                  itemValue={item.value}
                  triggerId={`gallery-tabs-${item.value}`}
                >
                  {[item.value, ' content']}
                </TabsPanel>
              )),
            ]}
          </Tabs>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, keyboard, programmatic',
        dataState: 'active, inactive, disabled',
        keyboard: 'Arrow keys move focus; Enter or Space activates the focused tab in manual mode',
      })}
    </section>
  );
}

export function ToastDemo() {
  const toast = (
    <Toast
      descriptionId={'gallery-toast-description'}
      id={'gallery-toast'}
      titleId={'gallery-toast-title'}
      variant={'success'}
    >
      {
        <>
          {<ToastTitle id={'gallery-toast-title'}>{'Deployment complete'}</ToastTitle>}
          {
            <ToastDescription id={'gallery-toast-description'}>
              {'Production is serving the new build.'}
            </ToastDescription>
          }
          {
            <ToastAction actionValue={'open-deploy'} id={'gallery-toast'} variant={'success'}>
              {'View deploy'}
            </ToastAction>
          }
          {
            <ToastAction
              actionValue={'keep-open'}
              dismissOnAction={false}
              id={'gallery-toast'}
              variant={'success'}
            >
              {'Keep open'}
            </ToastAction>
          }
          {
            <ToastAction
              actionValue={'blocked'}
              disabled={true}
              dismissOnAction={false}
              id={'gallery-toast'}
              variant={'success'}
            >
              {'Blocked'}
            </ToastAction>
          }
          {<ToastClose id={'gallery-toast'} variant={'success'} />}
        </>
      }
    </Toast>
  );

  return (
    <section data-gallery-demo="toast">
      <p data-demo-summary="no-js">
        Toast exposes a live-region viewport and dismiss/action buttons with inspectable state.
      </p>
      <div data-ui-demo="toast">
        {
          <ToastViewport
            id={'gallery-toast-viewport'}
            label={'Gallery notifications'}
            placement={'top-center'}
          >
            {[
              toast,
              <Toast
                id={'gallery-toast-hidden'}
                open={false}
                politeness={'assertive'}
                variant={'error'}
              />,
            ]}
          </ToastViewport>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'action-click, close-click, escape-key, timeout, programmatic',
        dataState: 'open, closed, disabled, variant',
        keyboard: 'Escape dismisses the active toast',
      })}
    </section>
  );
}

export function PopoverDemo() {
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
        {
          <Popover id={'gallery-popover'} open={state.open}>
            {[
              <PopoverTrigger {...state}>{'Filters'}</PopoverTrigger>,
              <PopoverContent {...state}>
                {'Status, owner, and due-date filters are available.'}
              </PopoverContent>,
            ]}
          </Popover>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, escape-key, native-beforetoggle, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native popover trigger toggles content; Escape closes the popover',
      })}
    </section>
  );
}

export function ProgressDemo() {
  return (
    <section data-gallery-demo="progress">
      <p data-demo-summary="no-js">
        Progress uses the native progress element for determinate and indeterminate states.
      </p>
      <div data-ui-demo="progress">
        {
          <Progress max={100} value={42} valueText={'42 of 100 tasks complete'}>
            {'42%'}
          </Progress>
        }
        {
          <Progress max={100} value={100}>
            {'100%'}
          </Progress>
        }
        {
          <Progress max={100} value={null}>
            {'Loading'}
          </Progress>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'value comes from app state',
        dataState: 'loading, complete, indeterminate',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function TooltipDemo() {
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
        {
          <Tooltip id={'gallery-tooltip'} open={state.open}>
            {[
              <TooltipTrigger {...state}>{'Inspect status'}</TooltipTrigger>,
              <TooltipContent {...state}>{'Status updates every minute.'}</TooltipContent>,
            ]}
          </Tooltip>
        }
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
