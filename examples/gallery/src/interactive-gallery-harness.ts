import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { compileComponentModule } from '../../../packages/compiler/src/compile.ts';
import * as primitiveActions from './primitive-actions.js';
import {
  createGalleryVmRequire,
  galleryRuntimeStub,
  primitiveActionsStub,
  transpileGalleryClientModuleForVm,
  type GalleryClientModuleManifest,
} from './client-module-manifest.js';

export const galleryRoot = resolve(import.meta.dirname, '..');
const compiledInteractiveDemos = new Map<string, CompiledInteractiveDemo>();
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

interface CompiledInteractiveDemo {
  readonly client: string;
  readonly clientModuleImportManifest: GalleryClientModuleManifest;
  readonly server: string;
}

export function readCompiledArtifact(fileName: string): string {
  const demo = compileInteractiveDemo(fileName);
  if (fileName.endsWith('.client.js')) return demo.client;

  return demo.server;
}

export function interactiveDemoNames(): string[] {
  return readdirSync(resolve(galleryRoot, 'src/interactive'))
    .filter((fileName) => fileName.endsWith('-demo.tsx'))
    .map((fileName) => fileName.replace(/\.tsx$/, ''))
    .sort(compareStrings);
}

export function extractClientExports(source: string): string[] {
  return [...source.matchAll(/export const ([A-Za-z0-9_$]+) = handler/g)]
    .map((match) => match[1] ?? '')
    .sort(compareStrings);
}

export function extractCompiledClientRefs(
  html: string,
): Array<{ eventName: string; exportName: string; modulePath: string; version: string }> {
  return [...html.matchAll(/on:([a-z]+)="([^"]+)"/g)].map((match) => {
    const eventName = match[1] ?? '';
    const ref = match[2] ?? '';
    const parsed = ref.match(
      /^\/c\/__v\/([0-9a-f][0-9a-f-]*)\/([^?#"]+\.client\.js)#([A-Za-z0-9_$]+)$/,
    );
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
  const server = readCompiledArtifact(fileName);
  const clientFileName = fileName.replace(/\.tsx$/, '.client.js');
  try {
    return `${server}\n${readCompiledArtifact(clientFileName)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return server;
    throw error;
  }
}

export function evaluateClientModule(
  fileName: string,
  globals: Record<string, unknown> = {},
): ClientExports {
  const demo = compileInteractiveDemo(fileName);
  const source = transpileGalleryClientModuleForVm(demo.client);
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    exports,
    module: { exports },
    require: createGalleryVmRequire(demo.clientModuleImportManifest, [
      galleryRuntimeStub(),
      primitiveActionsStub(primitiveActions),
    ]),
    setTimeout,
    ...globals,
  });

  return exports;
}

function compileInteractiveDemo(fileName: string): CompiledInteractiveDemo {
  const demoName = fileName.replace(/(?:\.client\.js|\.tsx)$/, '');
  const cached = compiledInteractiveDemos.get(demoName);
  if (cached !== undefined) return cached;

  const sourcePath = resolve(galleryRoot, `src/interactive/${demoName}.tsx`);
  const source = readFileSync(sourcePath, 'utf8');
  const componentFileName = `src/interactive/${demoName}.tsx`;
  const result = compileComponentModule({
    fileName: componentFileName,
    source,
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `Failed to compile ${componentFileName}:\n${errors
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  const server = normalizeCompiledServerSource(
    result.loweredSource ?? result.files.find((artifact) => artifact.kind === 'server')?.source,
  );
  const client = result.files.find((artifact) => artifact.kind === 'client')?.source;
  if (server === undefined || client === undefined) {
    throw new Error(`${componentFileName} did not emit both server and client artifacts.`);
  }

  const compiled = {
    client,
    clientModuleImportManifest: result.clientModuleImportManifest,
    server,
  };
  compiledInteractiveDemos.set(demoName, compiled);

  return compiled;
}

function normalizeCompiledServerSource(source: string | undefined): string | undefined {
  return source?.replace(/kovo-state="([^"]+)"/g, (_match, value: string) => {
    return `kovo-state='${value.replaceAll('&quot;', '"')}'`;
  });
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
