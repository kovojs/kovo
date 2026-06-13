import { runInThisContext } from 'node:vm';

import {
  buildInlineJisoLoaderInstallerSource,
  inlineJisoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import { createInlineJisoLoaderSource, installInlineJisoLoader } from './inline-loader.js';

export type InlineSourceInstall = (
  importModule: (url: string) => Promise<Record<string, unknown>>,
  globalRecord: Record<string, unknown>,
) => void;

export const inlineSourceInstallCases: readonly [string, InlineSourceInstall][] = [
  [
    'readable build source',
    (importModule, globalRecord) => {
      globalRecord.__jisoInlineImport = importModule;
      runInThisContext(
        `(${inlineJisoLoaderInstallerReadableSource})(globalThis.__jisoInlineImport);`,
      );
    },
  ],
  [
    'freshly minified build source',
    (importModule, globalRecord) => {
      globalRecord.__jisoInlineImport = importModule;
      runInThisContext(
        `(${buildInlineJisoLoaderInstallerSource()})(globalThis.__jisoInlineImport);`,
      );
    },
  ],
  [
    'generated bootstrap source',
    (importModule, globalRecord) => {
      globalRecord.__jisoInlineImport = importModule;
      runInThisContext(createInlineJisoLoaderSource('globalThis.__jisoInlineImport'));
    },
  ],
  ['extracted installer source', (importModule) => installInlineJisoLoader(importModule)],
] as const;

export async function dispatchInlineDelegatedClick(
  element: unknown,
  importModule: (url: string) => Promise<Record<string, unknown>>,
  installSource: InlineSourceInstall,
): Promise<void> {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const originals = {
    addEventListener: globalRecord.addEventListener,
    document: globalRecord.document,
    importModule: globalRecord.__jisoInlineImport,
  };
  const listeners = new Map<string, (event: unknown) => Promise<void>>();

  try {
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => Promise<void>) => {
      listeners.set(type, listener);
    };
    globalRecord.document = {
      querySelectorAll() {
        return [];
      },
    };

    installSource(importModule, globalRecord);

    await listeners.get('click')?.({
      target: element,
      type: 'click',
    });
  } finally {
    Object.assign(globalRecord, {
      addEventListener: originals.addEventListener,
      document: originals.document,
    });
    if (originals.importModule === undefined) {
      delete globalRecord.__jisoInlineImport;
    } else {
      globalRecord.__jisoInlineImport = originals.importModule;
    }
  }
}

export class InlineTriggerElement {
  readonly attributes: Array<{ name: string; value: string }> = [];

  constructor(private readonly attrs: Record<string, string>) {}

  closest(selector: string): InlineTriggerElement | null {
    if (selector === '[fw-state]') {
      return Object.hasOwn(this.attrs, 'fw-state') ? this : null;
    }

    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return trigger && Object.hasOwn(this.attrs, `on:${trigger}`) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

export class InlineParityRoot {
  deps: { deps?: string; id?: string; target?: string }[] = [];

  findFragmentTarget(): null {
    return null;
  }

  querySelectorAll(
    selector: string,
  ): Iterable<{ getAttribute(name: string): string | null; id?: string }> {
    if (selector !== '[fw-deps]') return [];

    return this.deps.map((dep) => ({
      getAttribute(name: string) {
        if (name === 'fw-fragment-target') return dep.target ?? null;
        if (name === 'fw-deps') return dep.deps ?? null;
        return null;
      },
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}
