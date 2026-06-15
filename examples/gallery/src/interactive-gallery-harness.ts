import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import * as headlessPrimitives from '@jiso/headless-ui/primitives';

export const galleryRoot = resolve(import.meta.dirname, '..');

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
    const parsed = ref.match(/^([^?#"]+)\?v=([0-9a-f]{8})#([A-Za-z0-9_$]+)$/);
    if (parsed === null) throw new Error(`Unexpected generated client ref: ${ref}`);

    return {
      eventName,
      exportName: parsed[3] ?? '',
      modulePath: parsed[1] ?? '',
      version: parsed[2] ?? '',
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

export function evaluateClientModule(
  fileName: string,
  globals: Record<string, unknown> = {},
): ClientExports {
  const source = readGenerated(fileName)
    .replace(/import \{[\s\S]*?\} from '@jiso\/runtime';\n\n?/, '')
    .replace(/import \{[\s\S]*?\} from '@jiso\/headless-ui\/primitives';\n\n?/, '')
    .replaceAll('export const ', 'exports.');
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    derive: (inputs: readonly string[], run: (...values: unknown[]) => unknown) => ({
      inputs,
      run,
    }),
    exports,
    handler: (fn: ClientExports[string]) => fn,
    ...headlessPrimitives,
    _accordionKeyDown: headlessPrimitives.accordionKeyDown,
    _accordionTriggerClick: headlessPrimitives.accordionTriggerClick,
    _checkboxGroupItemClick: headlessPrimitives.checkboxGroupItemClick,
    _checkboxTriggerClick: headlessPrimitives.checkboxTriggerClick,
    _collapsibleTriggerClick: headlessPrimitives.collapsibleTriggerClick,
    _disclosureTriggerClick: headlessPrimitives.disclosureTriggerClick,
    _meterValueState: headlessPrimitives.meterValueState,
    _numberFieldDecrementClick: headlessPrimitives.numberFieldDecrementClick,
    _numberFieldIncrementClick: headlessPrimitives.numberFieldIncrementClick,
    _numberFieldInput: headlessPrimitives.numberFieldInput,
    _numberFieldKeyDown: headlessPrimitives.numberFieldKeyDown,
    _radioGroupItemClick: headlessPrimitives.radioGroupItemClick,
    _radioGroupKeyDown: headlessPrimitives.radioGroupKeyDown,
    _switchTriggerClick: headlessPrimitives.switchTriggerClick,
    _tabsKeyDown: headlessPrimitives.tabsKeyDown,
    _tabsTriggerClick: headlessPrimitives.tabsTriggerClick,
    _toggleGroupItemClick: headlessPrimitives.toggleGroupItemClick,
    _toggleGroupKeyDown: headlessPrimitives.toggleGroupKeyDown,
    _toggleTriggerClick: headlessPrimitives.toggleTriggerClick,
    _toolbarKeyDown: headlessPrimitives.toolbarKeyDown,
    _tooltipEscapeKeyDown: headlessPrimitives.tooltipEscapeKeyDown,
    _tooltipTriggerBlur: headlessPrimitives.tooltipTriggerBlur,
    _tooltipTriggerFocus: headlessPrimitives.tooltipTriggerFocus,
    _tooltipTriggerPointerEnter: headlessPrimitives.tooltipTriggerPointerEnter,
    _tooltipTriggerPointerLeave: headlessPrimitives.tooltipTriggerPointerLeave,
    ...globals,
  });

  return exports;
}

export function clientHandler(exports: ClientExports, name: string): ClientExports[string] {
  const fn = exports[name];
  if (fn === undefined) throw new Error(`Missing generated handler export: ${name}`);

  return fn;
}

export function inputEvent(value: string): Event {
  const event = new Event('input', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: { value } });
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
