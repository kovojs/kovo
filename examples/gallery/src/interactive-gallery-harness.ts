import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

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

export const galleryRoot = resolve(import.meta.dirname, '..');
const primitiveActions = {
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

export type ClientExports = Record<
  string,
  (
    event: Event,
    ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
  ) => void
>;

export interface FakeElement {
  checked?: boolean;
  close?: () => void;
  hidden?: boolean;
  focus?: () => void;
  readonly setAttribute: (name: string, value: string) => void;
  scrollTop?: number;
  tabIndex?: number;
  textContent?: string;
  value?: string;
  readonly attrs: Record<string, string>;
  closeCalls: number;
  focusCalls: number;
}

export interface FakeDocument {
  readonly byId: Map<string, FakeElement>;
  readonly bySelector: Map<string, FakeElement>;
  readonly getElementById: (id: string) => FakeElement | undefined;
  readonly querySelector: (selector: string) => FakeElement | undefined;
}

export function readGenerated(fileName: string): string {
  return readFileSync(resolve(galleryRoot, `src/generated/interactive/${fileName}`), 'utf8');
}

export function generatedInteractiveDemoNames(): string[] {
  return readdirSync(resolve(galleryRoot, 'src/generated/interactive'))
    .filter((fileName) => fileName.endsWith('-demo.tsx'))
    .map((fileName) => fileName.replace(/\.tsx$/, ''))
    .sort(compareStrings);
}

export function extractClientExports(source: string): string[] {
  return [...source.matchAll(/export const ([A-Za-z0-9_$]+) = handler/g)]
    .map((match) => match[1] ?? '')
    .sort(compareStrings);
}

export function extractGeneratedClientRefs(
  html: string,
): Array<{ eventName: string; exportName: string; modulePath: string; version: string }> {
  return [...html.matchAll(/on:([a-z]+)="([^"]+)"/g)].map((match) => {
    const eventName = match[1] ?? '';
    const ref = match[2] ?? '';
    const parsed = ref.match(/^\/c\/__v\/([0-9a-f]{8})\/([^?#"]+\.client\.js)#([A-Za-z0-9_$]+)$/);
    if (parsed === null) throw new Error(`Unexpected generated client ref: ${ref}`);

    return {
      eventName,
      exportName: parsed[3] ?? '',
      modulePath: `/c/${parsed[2] ?? ''}`,
      version: parsed[1] ?? '',
    };
  });
}

export function pascalCase(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function readCompiledDemo(fileName: string): string {
  const server = readGenerated(fileName);
  const clientFileName = fileName.replace(/\.tsx$/, '.client.js');
  try {
    return `${server}\n${readGenerated(clientFileName)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return server;
    throw error;
  }
}

export function evaluateClientModule(
  fileName: string,
  globals: Record<string, unknown> = {},
): ClientExports {
  const source = readGenerated(fileName)
    .replace(/import \{[\s\S]*?\} from '@kovojs\/runtime(?:\/generated)?';\n\n?/, '')
    .replace(/import \{[\s\S]*?\} from '@kovojs\/headless-ui\/[^']+';\n\n?/g, '')
    .replace(/import \{[\s\S]*?\} from '@kovojs\/ui\/[^']+';\n\n?/g, '')
    .replaceAll('export const ', 'exports.');
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    derive: (inputs: readonly string[], run: (...values: unknown[]) => unknown) => ({
      inputs,
      run,
    }),
    exports,
    handler: (fn: ClientExports[string]) => fn,
    setTimeout,
    ...primitiveActions,
    _accordionKeyDown: primitiveActions.accordionKeyDown,
    _accordionTriggerClick: primitiveActions.accordionTriggerClick,
    _alertDialogActionClick: primitiveActions.alertDialogActionClick,
    _alertDialogCancel: primitiveActions.alertDialogCancel,
    _alertDialogCancelClick: primitiveActions.alertDialogCancelClick,
    _alertDialogTriggerClick: primitiveActions.alertDialogTriggerClick,
    _autocompleteInput: primitiveActions.autocompleteInput,
    _autocompleteKeyDown: primitiveActions.autocompleteKeyDown,
    _autocompleteOptionClick: primitiveActions.autocompleteOptionClick,
    _autocompleteSuggestions: primitiveActions.autocompleteSuggestions,
    _checkboxGroupItemClick: primitiveActions.checkboxGroupItemClick,
    _checkboxTriggerClick: primitiveActions.checkboxTriggerClick,
    _collapsibleTriggerClick: primitiveActions.collapsibleTriggerClick,
    _comboboxFilteredItems: primitiveActions.comboboxFilteredItems,
    _comboboxInput: primitiveActions.comboboxInput,
    _comboboxKeyDown: primitiveActions.comboboxKeyDown,
    _comboboxOptionClick: primitiveActions.comboboxOptionClick,
    _commandCloseClick: primitiveActions.commandCloseClick,
    _commandFilteredItems: primitiveActions.commandFilteredItems,
    _commandInput: primitiveActions.commandInput,
    _commandItemClick: primitiveActions.commandItemClick,
    _commandKeyDown: primitiveActions.commandKeyDown,
    _commandTriggerClick: primitiveActions.commandTriggerClick,
    _contextMenuFocusElement: primitiveActions.contextMenuFocusElement,
    _contextMenuItemClick: primitiveActions.contextMenuItemClick,
    _contextMenuItemKeyDown: primitiveActions.contextMenuItemKeyDown,
    _contextMenuKeyDown: primitiveActions.contextMenuKeyDown,
    _contextMenuMove: primitiveActions.contextMenuMove,
    _contextMenuTriggerContextMenu: primitiveActions.contextMenuTriggerContextMenu,
    _contextMenuTriggerKeyDown: primitiveActions.contextMenuTriggerKeyDown,
    _contextMenuTypeahead: primitiveActions.contextMenuTypeahead,
    _disclosureTriggerClick: primitiveActions.disclosureTriggerClick,
    _dialogCancel: primitiveActions.dialogCancel,
    _dialogCloseClick: primitiveActions.dialogCloseClick,
    _dialogTriggerClick: primitiveActions.dialogTriggerClick,
    _dropdownMenuFocusElement: primitiveActions.dropdownMenuFocusElement,
    _dropdownMenuItemClick: primitiveActions.dropdownMenuItemClick,
    _dropdownMenuItemKeyDown: primitiveActions.dropdownMenuItemKeyDown,
    _dropdownMenuKeyDown: primitiveActions.dropdownMenuKeyDown,
    _dropdownMenuMove: primitiveActions.dropdownMenuMove,
    _dropdownMenuTriggerClick: primitiveActions.dropdownMenuTriggerClick,
    _dropdownMenuTriggerKeyDown: primitiveActions.dropdownMenuTriggerKeyDown,
    _dropdownMenuTypeahead: primitiveActions.dropdownMenuTypeahead,
    _hoverCardContentPointerEnter: primitiveActions.hoverCardContentPointerEnter,
    _hoverCardContentPointerLeave: primitiveActions.hoverCardContentPointerLeave,
    _hoverCardEscapeKeyDown: primitiveActions.hoverCardEscapeKeyDown,
    _hoverCardTriggerBlur: primitiveActions.hoverCardTriggerBlur,
    _hoverCardTriggerFocus: primitiveActions.hoverCardTriggerFocus,
    _hoverCardTriggerPointerEnter: primitiveActions.hoverCardTriggerPointerEnter,
    _hoverCardTriggerPointerLeave: primitiveActions.hoverCardTriggerPointerLeave,
    _menubarFocusElement: primitiveActions.menubarFocusElement,
    _menubarItemClick: primitiveActions.menubarItemClick,
    _menubarItemKeyDown: primitiveActions.menubarItemKeyDown,
    _menubarKeyDown: primitiveActions.menubarKeyDown,
    _menubarMove: primitiveActions.menubarMove,
    _menubarSubmenuTriggerClick: primitiveActions.menubarSubmenuTriggerClick,
    _menubarTypeahead: primitiveActions.menubarTypeahead,
    _meterValueState: primitiveActions.meterValueState,
    _navigationMenuFocusElement: primitiveActions.navigationMenuFocusElement,
    _navigationMenuKeyDown: primitiveActions.navigationMenuKeyDown,
    _navigationMenuLinkClick: primitiveActions.navigationMenuLinkClick,
    _navigationMenuMove: primitiveActions.navigationMenuMove,
    _navigationMenuTriggerClick: primitiveActions.navigationMenuTriggerClick,
    _navigationMenuTriggerFocus: primitiveActions.navigationMenuTriggerFocus,
    _navigationMenuTriggerPointerEnter: primitiveActions.navigationMenuTriggerPointerEnter,
    _navigationMenuTypeahead: primitiveActions.navigationMenuTypeahead,
    _numberFieldDecrementClick: primitiveActions.numberFieldDecrementClick,
    _numberFieldIncrementClick: primitiveActions.numberFieldIncrementClick,
    _numberFieldInput: primitiveActions.numberFieldInput,
    _numberFieldKeyDown: primitiveActions.numberFieldKeyDown,
    _otpFieldInput: primitiveActions.otpFieldInput,
    _otpFieldKeyDown: primitiveActions.otpFieldKeyDown,
    _otpFieldPaste: primitiveActions.otpFieldPaste,
    _popoverBeforeToggle: primitiveActions.popoverBeforeToggle,
    _radioGroupItemClick: primitiveActions.radioGroupItemClick,
    _radioGroupKeyDown: primitiveActions.radioGroupKeyDown,
    _scrollAreaThumbGeometry: primitiveActions.scrollAreaThumbGeometry,
    _scrollAreaThumbDrag: primitiveActions.scrollAreaThumbDrag,
    _scrollAreaThumbDragStart: primitiveActions.scrollAreaThumbDragStart,
    _scrollAreaTrackPointerDown: primitiveActions.scrollAreaTrackPointerDown,
    _scrollAreaViewportScroll: primitiveActions.scrollAreaViewportScroll,
    _selectItemClick: primitiveActions.selectItemClick,
    _selectKeyDown: primitiveActions.selectKeyDown,
    _selectMove: primitiveActions.selectMove,
    _selectTriggerClick: primitiveActions.selectTriggerClick,
    _sliderKeyDown: primitiveActions.sliderKeyDown,
    _sliderThumbDrag: primitiveActions.sliderThumbDrag,
    _sliderThumbDragStart: primitiveActions.sliderThumbDragStart,
    _sliderTrackPointerDown: primitiveActions.sliderTrackPointerDown,
    _switchTriggerClick: primitiveActions.switchTriggerClick,
    _tabsKeyDown: primitiveActions.tabsKeyDown,
    _tabsTriggerClick: primitiveActions.tabsTriggerClick,
    _toggleGroupItemClick: primitiveActions.toggleGroupItemClick,
    _toggleGroupKeyDown: primitiveActions.toggleGroupKeyDown,
    _toggleTriggerClick: primitiveActions.toggleTriggerClick,
    _toolbarKeyDown: primitiveActions.toolbarKeyDown,
    _tooltipEscapeKeyDown: primitiveActions.tooltipEscapeKeyDown,
    _tooltipTriggerBlur: primitiveActions.tooltipTriggerBlur,
    _tooltipTriggerFocus: primitiveActions.tooltipTriggerFocus,
    _tooltipTriggerPointerEnter: primitiveActions.tooltipTriggerPointerEnter,
    _tooltipTriggerPointerLeave: primitiveActions.tooltipTriggerPointerLeave,
    _dismissToast: primitiveActions.dismissToast,
    _toastActionClick: primitiveActions.toastActionClick,
    _toastAnimationEnd: primitiveActions.toastAnimationEnd,
    _toastCloseClick: primitiveActions.toastCloseClick,
    _toastEscapeKeyDown: primitiveActions.toastEscapeKeyDown,
    _toastViewportKeyDown: primitiveActions.toastViewportKeyDown,
    ...globals,
  });

  return exports;
}

export function clientHandler(exports: ClientExports, name: string): ClientExports[string] {
  const resolvedName = resolveGeneratedBindingName(exports, name);
  const fn = exports[resolvedName];
  if (fn === undefined) throw new Error(`Missing generated handler export: ${name}`);

  return fn;
}

export function resolveGeneratedBindingName(
  exports: Record<string, unknown>,
  name: string,
): string {
  if (exports[name] !== undefined) return name;
  const aliasedName = legacyGeneratedBindingAliases[name];
  if (aliasedName !== undefined && exports[aliasedName] !== undefined) return aliasedName;

  const legacy = name.match(/^(Gallery[A-Za-z0-9]+Demo)\$[A-Za-z0-9]+_(.+?)(?:_([0-9]+))?$/);
  if (!legacy) return name;

  const [, componentName, bindingSuffix, ordinalText] = legacy;
  if (componentName === undefined || bindingSuffix === undefined) return name;
  const handlerPattern = new RegExp(
    `^${escapeRegExp(componentName)}\\$[A-Za-z0-9]+_${escapeRegExp(bindingSuffix)}(?:_[0-9]+)?$`,
  );
  const candidates = Object.keys(exports).filter((candidate) => handlerPattern.test(candidate));
  const ordinal = ordinalText === undefined ? 1 : Number(ordinalText);

  return candidates[ordinal - 1] ?? name;
}

const legacyGeneratedBindingAliases: Record<string, string> = {
  GalleryContextMenuDemo$button_click_2: 'GalleryContextMenuDemo$ContextMenuItem_click_2',
  GalleryContextMenuDemo$button_keydown: 'GalleryContextMenuDemo$ContextMenuItem_keydown',
  GalleryContextMenuDemo$button_keydown_2: 'GalleryContextMenuDemo$ContextMenuItem_keydown_2',
  GalleryContextMenuDemo$div_keydown: 'GalleryContextMenuDemo$ContextMenuTrigger_keydown',
  GalleryDropdownMenuDemo$button_click_3: 'GalleryDropdownMenuDemo$DropdownMenuItem_click_2',
  GalleryDropdownMenuDemo$button_keydown: 'GalleryDropdownMenuDemo$DropdownMenuTrigger_keydown',
  GalleryDropdownMenuDemo$button_keydown_2: 'GalleryDropdownMenuDemo$DropdownMenuItem_keydown',
  GalleryDropdownMenuDemo$button_keydown_3: 'GalleryDropdownMenuDemo$DropdownMenuItem_keydown_2',
  GalleryHoverCardDemo$a_focus: 'GalleryHoverCardDemo$HoverCardTrigger_focus',
  GalleryHoverCardDemo$a_keydown: 'GalleryHoverCardDemo$HoverCardTrigger_keydown',
  GalleryHoverCardDemo$a_pointerenter: 'GalleryHoverCardDemo$HoverCardTrigger_pointerenter',
  GalleryHoverCardDemo$a_pointerleave: 'GalleryHoverCardDemo$HoverCardTrigger_pointerleave',
  GalleryHoverCardDemo$aside_pointerenter: 'GalleryHoverCardDemo$HoverCardContent_pointerenter',
  GalleryHoverCardDemo$aside_pointerleave: 'GalleryHoverCardDemo$HoverCardContent_pointerleave',
  GalleryMenubarDemo$button_click: 'GalleryMenubarDemo$MenubarItem_click',
  GalleryMenubarDemo$button_click_2: 'GalleryMenubarDemo$MenubarItem_click_2',
  GalleryMenubarDemo$button_click_3: 'GalleryMenubarDemo$MenubarItem_click_3',
  GalleryMenubarDemo$button_keydown: 'GalleryMenubarDemo$MenubarItem_keydown',
  GalleryMenubarDemo$button_keydown_2: 'GalleryMenubarDemo$MenubarItem_keydown_2',
  GalleryNavigationMenuDemo$a_click: 'GalleryNavigationMenuDemo$NavigationMenuLink_click',
  GalleryNavigationMenuDemo$a_tabIndex_derive:
    'GalleryNavigationMenuDemo$NavigationMenuLink_tabIndex_derive',
  GalleryNavigationMenuDemo$button_click: 'GalleryNavigationMenuDemo$NavigationMenuTrigger_click',
  GalleryNavigationMenuDemo$button_pointerenter:
    'GalleryNavigationMenuDemo$NavigationMenuTrigger_pointerenter',
  GalleryNavigationMenuDemo$button_tabIndex_derive:
    'GalleryNavigationMenuDemo$NavigationMenuTrigger_tabIndex_derive',
  GalleryNavigationMenuDemo$section_keydown: 'GalleryNavigationMenuDemo$NavigationMenu_keydown',
  GalleryScrollAreaDemo$div_pointerdown: 'GalleryScrollAreaDemo$ScrollAreaScrollbar_pointerdown',
  GalleryScrollAreaDemo$div_scroll: 'GalleryScrollAreaDemo$ScrollAreaViewport_scroll',
  GalleryScrollAreaDemo$span_pointerdown: 'GalleryScrollAreaDemo$ScrollAreaThumb_pointerdown',
  GalleryScrollAreaDemo$span_pointermove: 'GalleryScrollAreaDemo$ScrollAreaThumb_pointermove',
  GalleryScrollAreaDemo$span_pointerup: 'GalleryScrollAreaDemo$ScrollAreaThumb_pointerup',
  GallerySelectDemo$button_click: 'GallerySelectDemo$SelectTrigger_click',
  GallerySelectDemo$button_keydown: 'GallerySelectDemo$SelectTrigger_keydown',
  GallerySelectDemo$div_click: 'GallerySelectDemo$SelectItem_click',
  GallerySelectDemo$div_click_2: 'GallerySelectDemo$SelectItem_click_2',
  GallerySelectDemo$div_click_3: 'GallerySelectDemo$SelectItem_click_3',
  GallerySliderDemo$div_pointerdown: 'GallerySliderDemo$SliderTrack_pointerdown',
  GallerySliderDemo$span_keydown: 'GallerySliderDemo$SliderThumb_keydown',
  GallerySliderDemo$span_pointerdown: 'GallerySliderDemo$SliderThumb_pointerdown',
  GallerySliderDemo$span_pointermove: 'GallerySliderDemo$SliderThumb_pointermove',
  GallerySliderDemo$span_pointerup: 'GallerySliderDemo$SliderThumb_pointerup',
  GalleryToastDemo$div_data_state_derive_2: 'GalleryToastDemo$Toast_data_state_derive_2',
  GalleryToastDemo$div_hidden_derive_2: 'GalleryToastDemo$Toast_hidden_derive_2',
  GalleryToastDemo$section_keydown: 'GalleryToastDemo$ToastViewport_keydown',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function asyncClientHandler(
  exports: ClientExports,
  name: string,
): (
  event: Event,
  ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
) => Promise<void> {
  return clientHandler(exports, name) as unknown as (
    event: Event,
    ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
  ) => Promise<void>;
}

export function inputEvent(value: string): Event {
  const event = new Event('input', { bubbles: true, cancelable: true });
  const target = { value };
  Object.defineProperty(event, 'currentTarget', { value: target });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

export function changeEvent(value: string): Event {
  const event = new Event('change', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: { value } });
  return event;
}

export function keyEvent(key: string): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

export function fakeDocument(options: {
  ids: readonly string[];
  selectors: readonly string[];
}): FakeDocument {
  const byId = new Map(options.ids.map((id) => [id, fakeElement()]));
  const bySelector = new Map(options.selectors.map((selector) => [selector, fakeElement()]));

  return {
    byId,
    bySelector,
    getElementById: (id) => byId.get(id),
    querySelector: (selector) => bySelector.get(selector),
  };
}

export function fakeElement(): FakeElement {
  const element: FakeElement = {
    attrs: {},
    closeCalls: 0,
    focusCalls: 0,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  element.close = () => {
    element.closeCalls += 1;
  };
  element.focus = () => {
    element.focusCalls += 1;
  };

  return element;
}

export function element(document: FakeDocument, id: string): FakeElement {
  const value = document.byId.get(id);
  if (value === undefined) throw new Error(`Missing fake element: ${id}`);

  return value;
}

export function selector(document: FakeDocument, query: string): FakeElement {
  const value = document.bySelector.get(query);
  if (value === undefined) throw new Error(`Missing fake selector: ${query}`);

  return value;
}
