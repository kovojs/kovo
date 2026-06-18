/** @jsxImportSource @kovojs/server */
import {
  mergePrimitiveAndAuthorAttributes,
  type MergeableAttribute,
  type MergeableAttributeValue,
} from './index.js';
import * as accordionPrimitives from '@kovojs/headless-ui/accordion';
import * as alertDialogPrimitives from '@kovojs/headless-ui/alert-dialog';
import * as autocompletePrimitives from '@kovojs/headless-ui/autocomplete';
import * as avatarPrimitives from '@kovojs/headless-ui/avatar';
import * as checkboxPrimitives from '@kovojs/headless-ui/checkbox';
import * as checkboxGroupPrimitives from '@kovojs/headless-ui/checkbox-group';
import * as collapsiblePrimitives from '@kovojs/headless-ui/collapsible';
import * as comboboxPrimitives from '@kovojs/headless-ui/combobox';
import * as commandPrimitives from '@kovojs/headless-ui/command';
import * as contextMenuPrimitives from '@kovojs/headless-ui/context-menu';
import * as dialogPrimitives from '@kovojs/headless-ui/dialog';
import * as disclosurePrimitives from '@kovojs/headless-ui/disclosure';
import * as dropdownMenuPrimitives from '@kovojs/headless-ui/dropdown-menu';
import * as fieldPrimitives from '@kovojs/headless-ui/field';
import * as hoverCardPrimitives from '@kovojs/headless-ui/hover-card';
import * as menubarPrimitives from '@kovojs/headless-ui/menubar';
import * as meterPrimitives from '@kovojs/headless-ui/meter';
import * as navigationMenuPrimitives from '@kovojs/headless-ui/navigation-menu';
import * as numberFieldPrimitives from '@kovojs/headless-ui/number-field';
import * as otpFieldPrimitives from '@kovojs/headless-ui/otp-field';
import * as popoverPrimitives from '@kovojs/headless-ui/popover';
import * as progressPrimitives from '@kovojs/headless-ui/progress';
import * as radioGroupPrimitives from '@kovojs/headless-ui/radio-group';
import * as scrollAreaPrimitives from '@kovojs/headless-ui/scroll-area';
import * as selectPrimitives from '@kovojs/headless-ui/select';
import * as separatorPrimitives from '@kovojs/headless-ui/separator';
import * as sliderPrimitives from '@kovojs/headless-ui/slider';
import * as switchPrimitives from '@kovojs/headless-ui/switch';
import * as tabsPrimitives from '@kovojs/headless-ui/tabs';
import * as toastPrimitives from '@kovojs/headless-ui/toast';
import * as togglePrimitives from '@kovojs/headless-ui/toggle';
import * as toggleGroupPrimitives from '@kovojs/headless-ui/toggle-group';
import * as toolbarPrimitives from '@kovojs/headless-ui/toolbar';
import * as tooltipPrimitives from '@kovojs/headless-ui/tooltip';

export const primitiveExports = {
  ...accordionPrimitives,
  ...alertDialogPrimitives,
  ...autocompletePrimitives,
  ...avatarPrimitives,
  ...checkboxPrimitives,
  ...checkboxGroupPrimitives,
  ...collapsiblePrimitives,
  ...comboboxPrimitives,
  ...commandPrimitives,
  ...contextMenuPrimitives,
  ...dialogPrimitives,
  ...disclosurePrimitives,
  ...dropdownMenuPrimitives,
  ...fieldPrimitives,
  ...hoverCardPrimitives,
  ...menubarPrimitives,
  ...meterPrimitives,
  ...navigationMenuPrimitives,
  ...numberFieldPrimitives,
  ...otpFieldPrimitives,
  ...popoverPrimitives,
  ...progressPrimitives,
  ...radioGroupPrimitives,
  ...scrollAreaPrimitives,
  ...selectPrimitives,
  ...separatorPrimitives,
  ...sliderPrimitives,
  ...switchPrimitives,
  ...tabsPrimitives,
  ...toastPrimitives,
  ...togglePrimitives,
  ...toggleGroupPrimitives,
  ...toolbarPrimitives,
  ...tooltipPrimitives,
};

export type AttributeValue = boolean | number | string | undefined;
export type AttributeRecord = Readonly<Record<string, AttributeValue>>;

export interface MergeDiagnostic {
  attr: string;
  code: 'KV231' | 'KV232' | 'KV233';
  message: string;
}

export interface MergeFixtureResult {
  attrs: Record<string, AttributeValue>;
  diagnostics: readonly MergeDiagnostic[];
}

export const idrefAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'kovo-context-menu',
  'kovo-hover-card',
  'kovo-tooltip',
  'popovertarget',
]);

export const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

export const primitiveAttributeBuilderNames = [
  'accordionContentAttributes',
  'accordionHeaderAttributes',
  'accordionItemAttributes',
  'accordionRootAttributes',
  'accordionTriggerAttributes',
  'alertDialogActionAttributes',
  'alertDialogCancelAttributes',
  'alertDialogContentAttributes',
  'alertDialogRootAttributes',
  'alertDialogTriggerAttributes',
  'autocompleteInputAttributes',
  'autocompleteListAttributes',
  'autocompleteOptionAttributes',
  'autocompleteRootAttributes',
  'autocompleteValueAttributes',
  'avatarFallbackAttributes',
  'avatarImageAttributes',
  'avatarRootAttributes',
  'checkboxGroupControlAttributes',
  'checkboxGroupItemAttributes',
  'checkboxGroupLabelAttributes',
  'checkboxGroupRootAttributes',
  'checkboxRootAttributes',
  'collapsibleContentAttributes',
  'collapsibleRootAttributes',
  'collapsibleTriggerAttributes',
  'comboboxInputAttributes',
  'comboboxListboxAttributes',
  'comboboxOptionAttributes',
  'comboboxRootAttributes',
  'comboboxValueAttributes',
  'commandCloseAttributes',
  'commandDialogAttributes',
  'commandEmptyAttributes',
  'commandInputAttributes',
  'commandItemAttributes',
  'commandListboxAttributes',
  'commandRootAttributes',
  'commandTriggerAttributes',
  'contextMenuContentAttributes',
  'contextMenuGroupAttributes',
  'contextMenuItemAttributes',
  'contextMenuRootAttributes',
  'contextMenuSeparatorAttributes',
  'contextMenuTriggerAttributes',
  'dialogCloseAttributes',
  'dialogContentAttributes',
  'dialogRootAttributes',
  'dialogTriggerAttributes',
  'disclosureContentAttributes',
  'disclosureRootAttributes',
  'disclosureTriggerAttributes',
  'dropdownMenuContentAttributes',
  'dropdownMenuGroupAttributes',
  'dropdownMenuItemAttributes',
  'dropdownMenuRootAttributes',
  'dropdownMenuSeparatorAttributes',
  'dropdownMenuTriggerAttributes',
  'fieldControlAttributes',
  'fieldDescriptionAttributes',
  'fieldErrorAttributes',
  'fieldLabelAttributes',
  'fieldRootAttributes',
  'fieldsetLegendAttributes',
  'fieldsetRootAttributes',
  'hoverCardContentAttributes',
  'hoverCardRootAttributes',
  'hoverCardTriggerAttributes',
  'menubarGroupAttributes',
  'menubarItemAttributes',
  'menubarRootAttributes',
  'menubarSeparatorAttributes',
  'menubarSubmenuAttributes',
  'meterRootAttributes',
  'navigationMenuContentAttributes',
  'navigationMenuIndicatorAttributes',
  'navigationMenuItemAttributes',
  'navigationMenuLinkAttributes',
  'navigationMenuListAttributes',
  'navigationMenuRootAttributes',
  'navigationMenuTriggerAttributes',
  'navigationMenuViewportAttributes',
  'numberFieldDecrementAttributes',
  'numberFieldIncrementAttributes',
  'numberFieldInputAttributes',
  'numberFieldRootAttributes',
  'otpFieldHiddenInputAttributes',
  'otpFieldInputAttributes',
  'otpFieldRootAttributes',
  'popoverContentAttributes',
  'popoverRootAttributes',
  'popoverTriggerAttributes',
  'progressRootAttributes',
  'radioGroupItemAttributes',
  'radioGroupLabelAttributes',
  'radioGroupRadioAttributes',
  'radioGroupRootAttributes',
  'scrollAreaCornerAttributes',
  'scrollAreaRootAttributes',
  'scrollAreaScrollbarAttributes',
  'scrollAreaThumbAttributes',
  'scrollAreaViewportAttributes',
  'selectContentAttributes',
  'selectHiddenInputAttributes',
  'selectItemAttributes',
  'selectRootAttributes',
  'selectTriggerAttributes',
  'selectValueAttributes',
  'separatorRootAttributes',
  'sliderHiddenInputAttributes',
  'sliderInputAttributes',
  'sliderRangeAttributes',
  'sliderRootAttributes',
  'sliderThumbAttributes',
  'sliderTrackAttributes',
  'switchRootAttributes',
  'tabsListAttributes',
  'tabsPanelAttributes',
  'tabsRootAttributes',
  'tabsTriggerAttributes',
  'toastActionAttributes',
  'toastCloseAttributes',
  'toastDescriptionAttributes',
  'toastRootAttributes',
  'toastTitleAttributes',
  'toastViewportAttributes',
  'toggleGroupButtonAttributes',
  'toggleGroupItemAttributes',
  'toggleGroupRootAttributes',
  'toggleRootAttributes',
  'toolbarButtonAttributes',
  'toolbarItemAttributes',
  'toolbarRootAttributes',
  'tooltipContentAttributes',
  'tooltipRootAttributes',
  'tooltipTriggerAttributes',
] as const;

export function renderMergedBuilder(name: string, attrs: AttributeRecord): string {
  return (
    <div data-gallery-merge-builder={name} {...attrs}>
      merged
    </div>
  );
}

export function samplePrimitiveAttributes(name: (typeof primitiveAttributeBuilderNames)[number]) {
  const builder = primitiveExports[name] as (options?: Record<string, unknown>) => AttributeRecord;

  if (name.startsWith('accordion')) return builder(accordionSample);
  if (name.startsWith('alertDialog')) return builder(dialogSample);
  if (name.startsWith('autocomplete')) return builder(autocompleteSample);
  if (name.startsWith('avatar')) return builder(avatarSample);
  if (name.startsWith('checkboxGroup')) return builder(checkboxGroupSample);
  if (name.startsWith('checkbox')) return builder(checkboxSample);
  if (name.startsWith('collapsible')) return builder(openSample);
  if (name.startsWith('combobox')) return builder(comboboxSample);
  if (name.startsWith('command')) return builder(commandSample);
  if (name.startsWith('contextMenu')) return builder(menuSample);
  if (name.startsWith('dialog')) return builder(dialogSample);
  if (name.startsWith('disclosure')) return builder(openSample);
  if (name.startsWith('dropdownMenu')) return builder(menuSample);
  if (name.startsWith('fieldset')) return builder(fieldSample);
  if (name.startsWith('field')) return builder(fieldSample);
  if (name.startsWith('hoverCard')) return builder(hoverCardSample);
  if (name.startsWith('menubar')) return builder(menubarSample);
  if (name.startsWith('meter')) return builder(meterSample);
  if (name.startsWith('navigationMenu')) return builder(navigationMenuSample);
  if (name.startsWith('numberField')) return builder(numberFieldSample);
  if (name.startsWith('otpField')) return builder(otpFieldSample);
  if (name.startsWith('popover')) return builder(popoverSample);
  if (name.startsWith('progress')) return builder(progressSample);
  if (name.startsWith('radioGroup')) return builder(radioGroupSample);
  if (name.startsWith('scrollArea')) return builder(scrollAreaSample);
  if (name.startsWith('select')) return builder(selectSample);
  if (name.startsWith('separator')) return builder(separatorSample);
  if (name.startsWith('slider')) return builder(sliderSample);
  if (name.startsWith('switch')) return builder(switchSample);
  if (name.startsWith('tabs')) return builder(tabsSample);
  if (name.startsWith('toast')) return builder(toastSample);
  if (name.startsWith('toggleGroup')) return builder(toggleGroupSample);
  if (name.startsWith('toggle')) return builder(toggleSample);
  if (name.startsWith('toolbar')) return builder(toolbarSample);
  if (name.startsWith('tooltip')) return builder(tooltipSample);

  throw new Error(`Missing primitive attrs sample for ${name}`);
}

export function authorStressAttrs(name: string, primitive: AttributeRecord): AttributeRecord {
  const author: Record<string, AttributeValue> = {
    class: `author-${name}`,
  };

  for (const attr of Object.keys(primitive)) {
    const value = primitive[attr];
    if (value === undefined || attr === 'class') continue;

    if (attr === 'data-state') {
      author[attr] = 'author-state';
      continue;
    }

    if (attr === 'role') {
      author[attr] = 'presentation';
      continue;
    }

    if (idrefAttributes.has(attr)) {
      author[attr] = `author-${attr}`;
      continue;
    }

    if (attr.startsWith('aria-')) {
      author[attr] = value === 'true' ? 'false' : 'author-aria';
      continue;
    }

    if (logicalOrAttributes.has(attr)) {
      author[attr] = true;
      continue;
    }

    if (attr === 'id') {
      author[attr] = `author-${name}`;
      continue;
    }

    if (typeof value === 'number') {
      author[attr] = value + 1;
      continue;
    }

    if (typeof value === 'string') {
      author[attr] = `author-${name}`;
    }
  }

  return author;
}

export const accordionSample = {
  contentId: 'panel',
  disabled: false,
  itemValue: 'one',
  level: 3,
  orientation: 'horizontal',
  triggerId: 'trigger',
  type: 'multiple',
  value: ['one'],
};
export const autocompleteSample = {
  descriptionId: 'description',
  errorId: 'error',
  highlightedValue: 'one',
  id: 'autocomplete',
  inputValue: 'on',
  invalid: true,
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listId: 'list',
  name: 'autocomplete',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
export const avatarSample = {
  delayMs: 250,
  label: 'Avatar',
  src: '/avatar.png',
  status: 'loaded',
};
export const checkboxGroupSample = {
  activeValue: 'one',
  controlId: 'control',
  descriptionId: 'description',
  errorId: 'error',
  id: 'checkbox-group',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'checkbox-group',
  orientation: 'horizontal',
  required: true,
  value: ['one'],
};
export const checkboxSample = {
  checked: 'indeterminate',
  disabled: false,
  id: 'checkbox',
  name: 'checkbox',
  required: true,
  value: 'one',
};
export const comboboxSample = {
  descriptionId: 'description',
  errorId: 'error',
  highlightedValue: 'one',
  id: 'combobox',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listboxId: 'listbox',
  name: 'combobox',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
export const commandSample = {
  contentId: 'command-dialog',
  descriptionId: 'description',
  highlightedValue: 'one',
  id: 'command',
  inputValue: 'on',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listboxId: 'listbox',
  open: true,
  placeholder: 'Run command',
  titleId: 'title',
  value: 'one',
};
export const dialogSample = {
  contentId: 'dialog',
  descriptionId: 'description',
  disabled: false,
  open: true,
  titleId: 'title',
};
export const fieldSample = {
  controlId: 'control',
  descriptionId: 'description',
  errorId: 'error',
  id: 'field',
  invalid: true,
  name: 'field',
  required: true,
  visible: true,
};
export const hoverCardSample = {
  contentId: 'hover-card-content',
  id: 'hover-card',
  labelledBy: 'label',
  open: true,
};
export const menuSample = {
  contentId: 'menu-content',
  highlightedValue: 'one',
  id: 'menu',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  open: true,
  point: { x: 10, y: 20 },
};
export const menubarSample = {
  activeValue: 'one',
  highlightedValue: 'one',
  id: 'menubar',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  orientation: 'horizontal',
  submenuOpenValue: 'one',
};
export const meterSample = {
  high: 90,
  id: 'meter',
  label: 'Usage',
  labelledBy: 'label',
  low: 30,
  max: 100,
  min: 0,
  optimum: 50,
  value: 40,
  valueText: '40 percent',
};
export const navigationMenuSample = {
  activeValue: 'one',
  contentId: 'nav-content',
  descriptionId: 'description',
  href: '/one',
  id: 'navigation-menu',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  label: 'Navigation',
  labelledBy: 'label',
  openValue: 'one',
};
export const numberFieldSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'number-field',
  invalid: true,
  label: 'Quantity',
  labelledBy: 'label',
  max: 10,
  min: 0,
  name: 'quantity',
  required: true,
  step: 1,
  value: 4,
};
export const openSample = {
  contentId: 'content',
  disabled: false,
  open: true,
};
export const otpFieldSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'otp',
  invalid: true,
  length: 6,
  name: 'otp',
  required: true,
  slot: 0,
  value: '123',
};
export const popoverSample = {
  contentId: 'popover-content',
  id: 'popover',
  labelledBy: 'label',
  open: true,
};
export const progressSample = {
  id: 'progress',
  label: 'Progress',
  labelledBy: 'label',
  max: 100,
  value: 40,
  valueText: '40 percent',
};
export const radioGroupSample = {
  activeValue: 'one',
  controlId: 'radio',
  descriptionId: 'description',
  errorId: 'error',
  id: 'radio-group',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'radio-group',
  orientation: 'horizontal',
  required: true,
  value: 'one',
};
export const scrollAreaSample = {
  descriptionId: 'description',
  dir: 'ltr',
  id: 'scroll-area',
  label: 'Scroll area',
  labelledBy: 'label',
  orientation: 'horizontal',
  scrollbars: 'both',
  visible: true,
};
export const selectSample = {
  contentId: 'select-content',
  highlightedValue: 'one',
  id: 'select',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  label: 'One',
  labelledBy: 'label',
  name: 'select',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
export const separatorSample = {
  decorative: false,
  id: 'separator',
  orientation: 'vertical',
};
export const sliderSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'slider',
  invalid: true,
  labelledBy: 'label',
  max: 100,
  min: 0,
  name: 'slider',
  orientation: 'horizontal',
  required: true,
  step: 1,
  value: 40,
  valueText: '40 percent',
};
export const switchSample = {
  checked: true,
  id: 'switch',
  name: 'switch',
  required: true,
  value: 'on',
};
export const tabsSample = {
  activeValue: 'one',
  descriptionId: 'description',
  id: 'tabs',
  itemValue: 'one',
  items: [{ value: 'one' }],
  label: 'Tabs',
  labelledBy: 'label',
  orientation: 'vertical',
  panelId: 'panel',
  triggerId: 'trigger',
  value: 'one',
};
export const toastSample = {
  descriptionId: 'description',
  id: 'toast',
  intent: 'action',
  label: 'Undo',
  open: true,
  titleId: 'title',
};
export const toggleGroupSample = {
  activeValue: 'one',
  id: 'toggle-group',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'toggle-group',
  orientation: 'horizontal',
  type: 'multiple',
  value: ['one'],
};
export const toggleSample = {
  disabled: false,
  id: 'toggle',
  label: 'Toggle',
  pressed: true,
};
export const toolbarSample = {
  activeValue: 'one',
  id: 'toolbar',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  orientation: 'horizontal',
};
export const tooltipSample = {
  contentId: 'tooltip-content',
  id: 'tooltip',
  labelledBy: 'label',
  open: true,
};

export function mergeCompilerPrimitiveAttrs(
  primitive: AttributeRecord,
  author: AttributeRecord,
): MergeFixtureResult {
  const order = mergedAttributeOrder(primitive, author);
  const merge = mergePrimitiveAndAuthorAttributes(
    attributeRecordEntries(primitive, 'primitive'),
    attributeRecordEntries(author, 'author'),
    { fileName: 'packages/compiler/src/gallery-merge-fixtures-oracle.tsx', source: '' },
  );

  return {
    attrs: Object.fromEntries(
      merge.attributes.flatMap((attribute) => {
        const value = fixtureAttributeValue(attribute.value);
        return value === undefined ? [] : [[attribute.name, value]];
      }),
    ),
    diagnostics: merge.diagnostics
      .map((diagnostic) =>
        galleryMergeDiagnostic(diagnostic.code as MergeDiagnostic['code'], diagnostic.message),
      )
      .sort((left, right) => order.indexOf(left.attr) - order.indexOf(right.attr)),
  };
}

export function rewriteIdrefs(
  attrs: AttributeRecord,
  rewrites: ReadonlyMap<string, string>,
): AttributeRecord {
  const rewritten: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(attrs)) {
    rewritten[key] =
      typeof value === 'string' && idrefAttributes.has(key)
        ? rewriteIdrefValue(value, rewrites)
        : value;
  }

  return rewritten;
}

export function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => rewrites.get(token) ?? token)
    .join(' ');
}

function attributeRecordEntries(
  attrs: AttributeRecord,
  origin: MergeableAttribute['origin'],
): readonly MergeableAttribute[] {
  return Object.entries(attrs).flatMap(([name, value]) => {
    const mergedValue = mergeableAttributeValue(value);
    return mergedValue === undefined ? [] : [{ name, origin, value: mergedValue }];
  });
}

function mergeableAttributeValue(value: AttributeValue): MergeableAttributeValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', value };
  return { kind: 'string', value };
}

function fixtureAttributeValue(value: MergeableAttributeValue): AttributeValue {
  if (value.kind === 'expression') return value.source;
  return value.value;
}

function galleryMergeDiagnostic(
  code: MergeDiagnostic['code'],
  compilerMessage: string,
): MergeDiagnostic {
  const attr = compilerMessage.slice(compilerMessage.lastIndexOf(' ') + 1);

  if (code === 'KV231') {
    return {
      attr,
      code,
      message: `Unmergeable primitive ${kv231ConflictKind(attr)} conflict per SPEC.md section 4.6`,
    };
  }

  if (code === 'KV233') {
    return {
      attr,
      code,
      message: 'Unmergeable primitive binding conflict per SPEC.md section 4.6',
    };
  }

  return {
    attr,
    code,
    message:
      attr === 'data-state' || (attr.startsWith('data-') && !attr.startsWith('data-p-'))
        ? 'Author override of primitive-owned state attribute per SPEC.md section 4.6'
        : 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
  };
}

function kv231ConflictKind(attr: string): string {
  if (attr.startsWith('data-p-')) return 'handler-param';
  if (attr === 'kovo-c' || attr === 'kovo-state') return 'island';
  return 'IDREF';
}

function mergedAttributeOrder(
  primitive: AttributeRecord,
  author: AttributeRecord,
): readonly string[] {
  return [...new Set([...Object.keys(primitive), ...Object.keys(author)])];
}
