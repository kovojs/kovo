/** @jsxImportSource @kovojs/server */
import { renderRouteHtml } from '@kovojs/server/rendering';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kovojs/ui/card';
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
  FieldErrorMessage,
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
import {
  galleryComponentEntries,
  type GalleryComponent,
  type GalleryComponentPath,
} from './gallery-component-manifest.js';

export type { GalleryComponent } from './gallery-component-manifest.js';

export type GalleryPrimitive = GalleryComponent;

export interface GalleryRoute {
  component: GalleryComponent;
  path: GalleryComponentPath;
  render(): unknown;
  title: string;
}

export interface GalleryFixture {
  component: GalleryComponent;
  html: string;
  path: GalleryRoute['path'];
  title: string;
}

const galleryDemoRenderers = {
  accordion: () => AccordionDemo(),
  alert: () => AlertDemo(),
  'alert-dialog': () => AlertDialogDemo(),
  autocomplete: () => AutocompleteDemo(),
  avatar: () => AvatarDemo(),
  badge: () => BadgeDemo(),
  breadcrumb: () => BreadcrumbDemo(),
  button: () => ButtonDemo(),
  card: () => CardDemo(),
  checkbox: () => CheckboxDemo(),
  'checkbox-group': () => CheckboxGroupDemo(),
  collapsible: () => CollapsibleDemo(),
  combobox: () => ComboboxDemo(),
  command: () => CommandDemo(),
  'context-menu': () => ContextMenuDemo(),
  dialog: () => DialogDemo(),
  disclosure: () => DisclosureDemo(),
  drawer: () => DrawerDemo(),
  'dropdown-menu': () => DropdownMenuDemo(),
  field: () => FieldDemo(),
  'hover-card': () => HoverCardDemo(),
  kbd: () => KbdDemo(),
  menubar: () => MenubarDemo(),
  meter: () => MeterDemo(),
  'navigation-menu': () => NavigationMenuDemo(),
  'number-field': () => NumberFieldDemo(),
  'otp-field': () => OtpFieldDemo(),
  popover: () => PopoverDemo(),
  progress: () => ProgressDemo(),
  'radio-group': () => RadioGroupDemo(),
  'scroll-area': () => ScrollAreaDemo(),
  select: () => SelectDemo(),
  separator: () => SeparatorDemo(),
  sheet: () => SheetDemo(),
  skeleton: () => SkeletonDemo(),
  slider: () => SliderDemo(),
  switch: () => SwitchDemo(),
  table: () => TableDemo(),
  tabs: () => TabsDemo(),
  toast: () => ToastDemo(),
  toggle: () => ToggleDemo(),
  'toggle-group': () => ToggleGroupDemo(),
  toolbar: () => ToolbarDemo(),
  tooltip: () => TooltipDemo(),
} satisfies Record<GalleryComponent, () => unknown>;

export const galleryRoutes: readonly GalleryRoute[] = Object.freeze(
  galleryComponentEntries.map(({ component, path, title }) => ({
    component,
    path,
    render: galleryDemoRenderers[component],
    title,
  })),
);

export async function galleryFixtures(): Promise<readonly GalleryFixture[]> {
  return Promise.all(
    galleryRoutes.map(async (route) => ({
      component: route.component,
      html: await renderGalleryRoute(route),
      path: route.path,
      title: route.title,
    })),
  );
}

export async function renderGalleryRoute(route: GalleryRoute): Promise<string> {
  return decodeTrustedGalleryHtml(
    renderRouteHtml(
      await Promise.resolve(
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
    ),
  );
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

export function AccordionDemo() {
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
        {
          <Accordion {...state} id={'gallery-accordion'}>
            {[
              <AccordionItem {...shipping}>
                {[
                  <AccordionHeader {...shipping} level={3}>
                    {
                      <AccordionTrigger
                        {...shipping}
                        contentId={'gallery-accordion-shipping-panel'}
                        triggerId={'gallery-accordion-shipping-trigger'}
                      >
                        {'Shipping'}
                      </AccordionTrigger>
                    }
                  </AccordionHeader>,
                  <AccordionContent
                    {...shipping}
                    contentId={'gallery-accordion-shipping-panel'}
                    triggerId={'gallery-accordion-shipping-trigger'}
                  >
                    {'Ships from the nearest warehouse.'}
                  </AccordionContent>,
                ]}
              </AccordionItem>,
              <AccordionItem {...billing}>
                {[
                  <AccordionHeader {...billing} level={3}>
                    {
                      <AccordionTrigger
                        {...billing}
                        contentId={'gallery-accordion-billing-panel'}
                        triggerId={'gallery-accordion-billing-trigger'}
                      >
                        {'Billing'}
                      </AccordionTrigger>
                    }
                  </AccordionHeader>,
                  <AccordionContent
                    {...billing}
                    contentId={'gallery-accordion-billing-panel'}
                    triggerId={'gallery-accordion-billing-trigger'}
                  >
                    {'Invoices remain available after checkout.'}
                  </AccordionContent>,
                ]}
              </AccordionItem>,
            ]}
          </Accordion>
        }
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
export function AvatarDemo() {
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
        {
          <Avatar {...loading} label={'Ada Lovelace avatar'}>
            {[
              <AvatarImage
                {...loading}
                alt={'Ada Lovelace'}
                decoding={'async'}
                loading={'lazy'}
                sizes={'40px'}
              />,
              <AvatarFallback {...loading} delayMs={250}>
                {'AL'}
              </AvatarFallback>,
            ]}
          </Avatar>
        }
        {
          <Avatar {...loaded} label={'Grace Hopper avatar'}>
            {[
              <AvatarImage {...loaded} alt={'Grace Hopper'} />,
              <AvatarFallback {...loaded}>{'GH'}</AvatarFallback>,
            ]}
          </Avatar>
        }
        {
          <Avatar {...error} label={'Lin Wei avatar'}>
            {[
              <AvatarImage {...error} alt={'Lin Wei'} />,
              <AvatarFallback {...error}>{'LW'}</AvatarFallback>,
            ]}
          </Avatar>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'image-load, image-error, programmatic',
        dataState: 'loading, loaded, error',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function AlertDemo() {
  return (
    <section data-gallery-demo="alert">
      <p data-demo-summary="no-js">
        Alert keeps status and alert roles in source-authored markup with no client behavior.
      </p>
      <div data-ui-demo="alert">
        {
          <Alert title={'Import complete'} variant={'success'}>
            {'Imports completed successfully.'}
          </Alert>
        }
        {
          <Alert role={'alert'} title={'Billing issue'} variant={'danger'}>
            {'Payment method must be updated before renewal.'}
          </Alert>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function AlertDialogDemo() {
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
        {
          <AlertDialog {...state} id={'gallery-alert-dialog'}>
            {[
              <AlertDialogTrigger {...state} open={false}>
                {'Delete project'}
              </AlertDialogTrigger>,
              <AlertDialogContent {...state}>
                {[
                  '<h2 id="gallery-alert-dialog-title">Delete production project?</h2><p id="gallery-alert-dialog-description">This action removes deploy tokens and cannot be undone.</p>',
                  <AlertDialogCancel {...state} autoFocus={true}>
                    {'Cancel'}
                  </AlertDialogCancel>,
                  <AlertDialogAction {...state} intent={'destructive'}>
                    {'Delete'}
                  </AlertDialogAction>,
                ]}
              </AlertDialogContent>,
            ]}
          </AlertDialog>
        }
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

export function AutocompleteDemo() {
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
        {
          <Autocomplete {...state} id={'gallery-autocomplete'}>
            {
              <>
                {
                  <AutocompleteInput
                    {...state}
                    id={'gallery-autocomplete-input'}
                    labelledBy={'gallery-autocomplete-label'}
                    placeholder={'Search plans'}
                  />
                }
                {
                  <AutocompleteList
                    {...state}
                    id={'gallery-autocomplete-list'}
                    labelledBy={'gallery-autocomplete-label'}
                  >
                    {items.map((item) => (
                      <AutocompleteOption
                        {...state}
                        itemLabel={item.label}
                        itemValue={item.value}
                      />
                    ))}
                  </AutocompleteList>
                }
                {<AutocompleteValue {...state} id={'gallery-autocomplete-value'} />}
                <p id="gallery-autocomplete-description">Suggestions remain browser-native.</p>
              </>
            }
          </Autocomplete>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, option-select, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, highlighted, disabled',
        keyboard: 'Arrow keys open and move over enabled suggestions; Escape closes suggestions',
      })}
    </section>
  );
}

export function BadgeDemo() {
  return (
    <section data-gallery-demo="badge">
      <p data-demo-summary="no-js">
        Badge is a pure styled source component with no behavior island.
      </p>
      <div data-ui-demo="badge">
        {<Badge variant={'neutral'}>{'Draft'}</Badge>}
        {<Badge variant={'success'}>{'Live'}</Badge>}
        {<Badge variant={'warning'}>{'Needs review'}</Badge>}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function BreadcrumbDemo() {
  const account = (
    <BreadcrumbItem>
      {<BreadcrumbLink href={'/account'}>{'Account'}</BreadcrumbLink>}
    </BreadcrumbItem>
  );
  const separator = <BreadcrumbSeparator />;
  const billing = (
    <BreadcrumbItem>{<BreadcrumbLink current={true}>{'Billing'}</BreadcrumbLink>}</BreadcrumbItem>
  );

  return (
    <section data-gallery-demo="breadcrumb">
      <p data-demo-summary="no-js">
        Breadcrumb is a native navigation list with current-page and decorative separator semantics.
      </p>
      <div data-ui-demo="breadcrumb">
        <Breadcrumb label={'Account path'}>{[account, separator, billing]}</Breadcrumb>
      </div>
      {renderBehaviorContract({
        changeReasons: 'native link navigation',
        dataState: 'not emitted',
        keyboard: 'Native link keyboard behavior',
      })}
    </section>
  );
}

export function ButtonDemo() {
  return (
    <section data-gallery-demo="button">
      <p data-demo-summary="no-js">
        Button keeps the native button element and submit/reset behavior available without JS.
      </p>
      <form id="gallery-button-form" data-gallery-form="button" />
      <div data-ui-demo="button">
        {
          <Button
            form={'gallery-button-form'}
            name={'gallery-action'}
            type={'submit'}
            value={'save'}
          >
            {'Save changes'}
          </Button>
        }
        {<Button variant={'secondary'}>{'Preview'}</Button>}
        {
          <Button disabled={true} variant={'ghost'}>
            {'Archived'}
          </Button>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'native click or form submit',
        dataState: 'disabled via native attribute',
        keyboard: 'Space or Enter activates the native button',
      })}
    </section>
  );
}

export function CardDemo() {
  const anatomy = [
    <CardHeader>
      {[
        <CardTitle>{'Release candidate'}</CardTitle>,
        <CardDescription>{'Security review and package checks are complete.'}</CardDescription>,
      ]}
    </CardHeader>,
    <CardContent>{'Ready for the production deployment window.'}</CardContent>,
    <CardFooter>{'Last verified just now'}</CardFooter>,
  ];

  return (
    <section data-gallery-demo="card">
      <p data-demo-summary="no-js">
        Card exposes one header, title, description, content, and footer anatomy in pure markup.
      </p>
      <div data-ui-demo="card">{<Card>{anatomy}</Card>}</div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function CheckboxDemo() {
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
          {
            <Checkbox
              checked={true}
              describedBy={'gallery-checkbox-help'}
              form={'gallery-checkbox-form'}
              id={'gallery-checkbox-consent'}
              name={'gallery-consent'}
              required={true}
              value={'accepted'}
            >
              {'Accept terms'}
            </Checkbox>
          }
        </span>
        <span data-fixture-state="indeterminate">
          {
            <Checkbox checked={'indeterminate'} name={'gallery-partial'} value={'partial'}>
              {'Some permissions'}
            </Checkbox>
          }
        </span>
        <span data-fixture-state="disabled">
          {
            <Checkbox checked={false} disabled={true}>
              {'Locked option'}
            </Checkbox>
          }
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

export function CheckboxGroupDemo() {
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
        {
          <CheckboxGroup
            {...state}
            errorId={'gallery-checkbox-group-error'}
            invalid={true}
            labelledBy={'gallery-checkbox-group-label'}
          >
            {items.map((item) => (
              <CheckboxGroupItem {...state} itemValue={item.value}>
                {
                  <>
                    {
                      <CheckboxGroupControl
                        {...state}
                        controlId={`gallery-checkbox-group-${item.value}`}
                        itemValue={item.value}
                      />
                    }
                    {
                      <CheckboxGroupLabel
                        {...state}
                        controlId={`gallery-checkbox-group-${item.value}`}
                        itemValue={item.value}
                      >
                        {item.value}
                      </CheckboxGroupLabel>
                    }
                  </>
                }
              </CheckboxGroupItem>
            ))}
          </CheckboxGroup>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'item-click, keyboard, programmatic',
        dataState: 'checked, unchecked, disabled',
        keyboard: 'Arrow keys move focus over enabled checkbox items; Space toggles focused item',
      })}
    </section>
  );
}

export function CollapsibleDemo() {
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
        {
          <Collapsible id={'gallery-collapsible'} open={state.open}>
            {[
              <CollapsibleTrigger {...state}>{'Release notes'}</CollapsibleTrigger>,
              <CollapsibleContent {...state}>
                {'Includes dependency updates and migration notes.'}
              </CollapsibleContent>,
            ]}
          </Collapsible>
        }
        {
          <Collapsible disabled={true} id={'gallery-collapsible-disabled'} open={false}>
            {[
              <CollapsibleTrigger
                contentId={'gallery-collapsible-disabled-content'}
                disabled={true}
              >
                {'Archived notes'}
              </CollapsibleTrigger>,
              <CollapsibleContent contentId={'gallery-collapsible-disabled-content'}>
                {'Archived content remains present for no-JS readers.'}
              </CollapsibleContent>,
            ]}
          </Collapsible>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Native summary toggles the details element',
      })}
    </section>
  );
}

export function ComboboxDemo() {
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
        {
          <Combobox {...state} id={'gallery-combobox'}>
            {
              <>
                {
                  <ComboboxInput
                    {...state}
                    id={'gallery-combobox-input'}
                    labelledBy={'gallery-combobox-label'}
                  />
                }
                {
                  <ComboboxListbox
                    {...state}
                    id={'gallery-combobox-listbox'}
                    labelledBy={'gallery-combobox-label'}
                  >
                    {items.map((item, index) => (
                      <ComboboxOption
                        {...state}
                        id={`gallery-combobox-listbox-option-${index}`}
                        itemLabel={item.label}
                        itemValue={item.value}
                      />
                    ))}
                  </ComboboxListbox>
                }
                {<ComboboxValue {...state} id={'gallery-combobox-value'} />}
                <p id="gallery-combobox-description">Choose a release owner.</p>
              </>
            }
          </Combobox>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'input, option-select, arrow-key, escape-key, typeahead, programmatic',
        dataState: 'open, closed, checked, unchecked, highlighted, disabled',
        keyboard: 'Arrow keys open and move over enabled options; Escape closes the listbox',
      })}
    </section>
  );
}

export function CommandDemo() {
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
        {
          <Command {...state} id={'gallery-command'}>
            {
              <>
                {
                  <CommandTrigger
                    {...state}
                    contentId={'gallery-command-dialog'}
                    id={'gallery-command-trigger'}
                  />
                }
                {
                  <CommandDialog
                    {...state}
                    contentId={'gallery-command-dialog'}
                    descriptionId={'gallery-command-description'}
                    titleId={'gallery-command-title'}
                  >
                    {
                      <>
                        <h2 id="gallery-command-title">Command menu</h2>
                        <p id="gallery-command-description">Search project actions.</p>
                        {
                          <CommandInput
                            {...state}
                            id={'gallery-command-input'}
                            labelledBy={'gallery-command-title'}
                            listboxId={'gallery-command-listbox'}
                          />
                        }
                        {
                          <CommandListbox
                            {...state}
                            id={'gallery-command-listbox'}
                            labelledBy={'gallery-command-title'}
                          >
                            {items.map((item) => (
                              <CommandItem
                                {...state}
                                id={`gallery-command-listbox-item-${items.indexOf(item)}`}
                                {...(item.disabled === undefined
                                  ? {}
                                  : { itemDisabled: item.disabled })}
                                itemLabel={item.label}
                                itemValue={item.value}
                              />
                            ))}
                          </CommandListbox>
                        }
                        {
                          <CommandEmpty inputValue={'zzz'} items={items}>
                            {'No matching command'}
                          </CommandEmpty>
                        }
                        {<CommandClose {...state} contentId={'gallery-command-dialog'} />}
                        {<CommandValue {...state} id={'gallery-command-value'} />}
                      </>
                    }
                  </CommandDialog>
                }
              </>
            }
          </Command>
        }
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

export function ContextMenuDemo() {
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
        {
          <ContextMenu {...state} id={'gallery-context-menu'}>
            {
              <>
                {
                  <ContextMenuTrigger
                    {...state}
                    contentId={'gallery-context-menu-content'}
                    id={'gallery-context-menu-trigger'}
                  />
                }
                {
                  <ContextMenuContent {...state} id={'gallery-context-menu-content'}>
                    {items.map((item) => (
                      <ContextMenuItem
                        {...state}
                        id={`gallery-context-menu-${item.value}`}
                        {...(item.disabled === undefined ? {} : { itemDisabled: item.disabled })}
                        itemLabel={item.label}
                        itemValue={item.value}
                      />
                    ))}
                  </ContextMenuContent>
                }
              </>
            }
          </ContextMenu>
        }
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

export function DialogDemo() {
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
        {
          <Dialog {...root} id={'gallery-dialog'}>
            {[
              <DialogTrigger {...trigger}>{'Open preview'}</DialogTrigger>,
              <DialogContent {...content}>
                {[
                  '<h2 id="gallery-dialog-title">Publish gallery changes</h2><p id="gallery-dialog-description">Review the demo route before publishing.</p>',
                  <DialogClose {...close}>{'Close'}</DialogClose>,
                ]}
              </DialogContent>,
            ]}
          </Dialog>
        }
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

export function DisclosureDemo() {
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
        {
          <Disclosure id={'gallery-disclosure'} open={state.open}>
            {[
              <DisclosureTrigger {...state}>{'Show audit details'}</DisclosureTrigger>,
              <DisclosureContent {...state}>
                {'Two reviewers approved the release.'}
              </DisclosureContent>,
            ]}
          </Disclosure>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'open, closed, disabled',
        keyboard: 'Space or Enter activates the disclosure button',
      })}
    </section>
  );
}

export function DropdownMenuDemo() {
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
        {
          <DropdownMenu {...state} id={'gallery-dropdown-menu'}>
            {
              <>
                {
                  <DropdownMenuTrigger
                    {...state}
                    contentId={'gallery-dropdown-menu-content'}
                    id={'gallery-dropdown-menu-trigger'}
                  />
                }
                {
                  <DropdownMenuContent {...state} id={'gallery-dropdown-menu-content'}>
                    {items.map((item) => (
                      <DropdownMenuItem
                        {...state}
                        id={`gallery-dropdown-menu-${item.value}`}
                        {...(item.disabled === undefined ? {} : { itemDisabled: item.disabled })}
                        itemLabel={item.label}
                        itemValue={item.value}
                      />
                    ))}
                  </DropdownMenuContent>
                }
              </>
            }
          </DropdownMenu>
        }
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

export function FieldDemo() {
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
        {
          <Field {...fieldState} id={'gallery-field'}>
            {
              <>
                {
                  <FieldLabel
                    {...fieldState}
                    controlId={'gallery-field-email'}
                    id={'gallery-field-label'}
                  >
                    {'Email'}
                  </FieldLabel>
                }
                {
                  <FieldControl
                    {...fieldState}
                    autoComplete={'email'}
                    descriptionId={'gallery-field-description'}
                    errorId={'gallery-field-error'}
                    form={'gallery-field-external-form'}
                    id={'gallery-field-email'}
                    inputMode={'email'}
                    maxLength={80}
                    minLength={3}
                    name={'email'}
                    pattern={'.+@example\\.com'}
                    placeholder={'ada@example.com'}
                    type={'email'}
                  />
                }
                {
                  <FieldDescription id={'gallery-field-description'}>
                    {'Used for release notifications.'}
                  </FieldDescription>
                }
                {
                  <FieldErrorMessage id={'gallery-field-error'}>
                    {'Email is required.'}
                  </FieldErrorMessage>
                }
              </>
            }
          </Field>
        }
        {
          <Field id={'gallery-field-bio-row'}>
            {
              <>
                {
                  <FieldLabel controlId={'gallery-field-bio'} id={'gallery-field-bio-label'}>
                    {'Profile note'}
                  </FieldLabel>
                }
                {
                  <FieldTextarea
                    autoComplete={'off'}
                    descriptionId={'gallery-field-bio-description'}
                    form={'gallery-field-external-form'}
                    id={'gallery-field-bio'}
                    maxLength={240}
                    name={'bio'}
                    rows={3}
                  >
                    {'Prefers changelog emails and release candidate previews.'}
                  </FieldTextarea>
                }
                {
                  <FieldDescription id={'gallery-field-bio-description'}>
                    {'Textarea keeps the same description IDREF contract as inputs.'}
                  </FieldDescription>
                }
              </>
            }
          </Field>
        }
        {
          <Field id={'gallery-field-plan-row'} required={true}>
            {
              <>
                {
                  <FieldLabel
                    controlId={'gallery-field-plan'}
                    id={'gallery-field-plan-label'}
                    required={true}
                  >
                    {'Workspace plan'}
                  </FieldLabel>
                }
                {
                  <FieldSelect
                    descriptionId={'gallery-field-plan-description'}
                    form={'gallery-field-external-form'}
                    id={'gallery-field-plan'}
                    name={'plan'}
                    required={true}
                    value={'team'}
                  >
                    {[
                      <FieldSelectOption value={'starter'}>{'Starter'}</FieldSelectOption>,
                      <FieldSelectOption selected={true} value={'team'}>
                        {'Team'}
                      </FieldSelectOption>,
                      <FieldSelectOption disabled={true} value={'enterprise'}>
                        {'Enterprise'}
                      </FieldSelectOption>,
                    ]}
                  </FieldSelect>
                }
                {
                  <FieldDescription id={'gallery-field-plan-description'}>
                    {'Select controls preserve native option submission.'}
                  </FieldDescription>
                }
              </>
            }
          </Field>
        }
        {
          <Fieldset
            descriptionId={'gallery-fieldset-description'}
            disabled={true}
            form={'gallery-field-external-form'}
            id={'gallery-fieldset'}
            invalid={true}
            name={'seat-options'}
          >
            {
              <>
                {<FieldsetLegend id={'gallery-fieldset-legend'}>{'Plan'}</FieldsetLegend>}
                {
                  <FieldLabel
                    controlId={'gallery-fieldset-seat'}
                    id={'gallery-fieldset-seat-label'}
                  >
                    {'Seat preference'}
                  </FieldLabel>
                }
                {
                  <FieldControl
                    descriptionId={'gallery-fieldset-description'}
                    form={'gallery-field-external-form'}
                    id={'gallery-fieldset-seat'}
                    name={'seat'}
                    value={'window'}
                  />
                }
                {
                  <FieldDescription id={'gallery-fieldset-description'}>
                    {'Fieldset preserves the native grouping element.'}
                  </FieldDescription>
                }
              </>
            }
          </Fieldset>
        }
      </div>
      {renderBehaviorContract({
        changeReasons: 'native form control changes',
        dataState: 'invalid, required, disabled',
        keyboard: 'Native field and fieldset semantics',
      })}
    </section>
  );
}

export function HoverCardDemo() {
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
        {
          <HoverCard id={'gallery-hover-card'} open={state.open}>
            {[
              <HoverCardTrigger {...state} href={'/team/ada'}>
                {'Ada Lovelace'}
              </HoverCardTrigger>,
              <HoverCardContent {...state}>
                {'<strong>Compiler owner</strong><p>Maintains release quality gates.</p>'}
              </HoverCardContent>,
            ]}
          </HoverCard>
        }
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

export function KbdDemo() {
  return (
    <section data-gallery-demo="kbd">
      <p data-demo-summary="no-js">
        Keyboard hints remain semantic kbd elements and do not require behavior wiring.
      </p>
      <div data-ui-demo="kbd">
        {<Kbd>{'Ctrl'}</Kbd>}
        {<Kbd>{'K'}</Kbd>}
      </div>
      {renderBehaviorContract({
        changeReasons: 'not stateful',
        dataState: 'not emitted',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

export function MenubarDemo() {
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
        {
          <Menubar {...state} label={'Document commands'}>
            {
              <>
                {
                  <MenubarItem
                    {...state}
                    contentId={'gallery-menubar-file-menu'}
                    id={'gallery-menubar-file'}
                    itemLabel={'File'}
                    itemValue={'file'}
                  />
                }
                {
                  <MenubarItem
                    {...state}
                    id={'gallery-menubar-edit'}
                    itemLabel={'Edit'}
                    itemValue={'edit'}
                  />
                }
                {
                  <MenubarSubmenu
                    {...state}
                    id={'gallery-menubar-file-menu'}
                    labelledBy={'gallery-menubar-file'}
                    value={'file'}
                  >
                    {
                      <>
                        {
                          <MenubarItem
                            {...state}
                            activeValue={'new'}
                            id={'gallery-menubar-new'}
                            itemLabel={'New'}
                            itemParentValue={'file'}
                            itemValue={'new'}
                          />
                        }
                        {
                          <MenubarItem
                            {...state}
                            activeValue={'new'}
                            id={'gallery-menubar-import'}
                            itemDisabled={true}
                            itemLabel={'Import'}
                            itemParentValue={'file'}
                            itemValue={'import'}
                          />
                        }
                      </>
                    }
                  </MenubarSubmenu>
                }
              </>
            }
          </Menubar>
        }
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

export function NavigationMenuDemo() {
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
        {
          <NavigationMenu {...state} label={'Primary navigation'}>
            {
              <>
                {
                  <NavigationMenuList {...state} id={'gallery-navigation-list'}>
                    {
                      <>
                        {
                          <NavigationMenuItem
                            {...state}
                            id={'gallery-navigation-products-item'}
                            itemValue={'products'}
                          >
                            {
                              <NavigationMenuTrigger
                                {...state}
                                contentId={'gallery-navigation-products-panel'}
                                id={'gallery-navigation-products-trigger'}
                                itemLabel={'Products'}
                                itemValue={'products'}
                              />
                            }
                          </NavigationMenuItem>
                        }
                        {
                          <NavigationMenuItem
                            {...state}
                            id={'gallery-navigation-docs-item'}
                            itemValue={'docs'}
                          >
                            {
                              <NavigationMenuLink
                                {...state}
                                href={'/docs'}
                                id={'gallery-navigation-docs-link'}
                                itemLabel={'Docs'}
                                itemValue={'docs'}
                              />
                            }
                          </NavigationMenuItem>
                        }
                      </>
                    }
                  </NavigationMenuList>
                }
                {
                  <NavigationMenuContent
                    {...state}
                    id={'gallery-navigation-products-panel'}
                    labelledBy={'gallery-navigation-products-trigger'}
                    value={'products'}
                  >
                    {'Product links stay grouped with their trigger.'}
                  </NavigationMenuContent>
                }
                {<NavigationMenuViewport {...state} id={'gallery-navigation-viewport'} />}
              </>
            }
          </NavigationMenu>
        }
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
