import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createInlineKovoLoaderSource } from './inline-loader.js';

describe('inline loader source', () => {
  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      htmlFormElement: globalRecord.HTMLFormElement,
      importModule: globalRecord.__kovoInlineImport,
      location: globalRecord.location,
      mouseEvent: globalRecord.MouseEvent,
      removeEventListener: globalRecord.removeEventListener,
      requestAnimationFrame: globalRecord.requestAnimationFrame,
      submitEvent: globalRecord.SubmitEvent,
    };
    const listeners = new Map<string, unknown>();
    const rafCallbacks: Function[] = [];
    const importModule = vi.fn(async () => ({}));
    class FakeHTMLFormElement {
      submit(): void {
        if (!(this instanceof FakeHTMLFormElement)) throw new TypeError('invalid form receiver');
      }
    }
    class FakeMouseEvent extends Event {}
    class FakeSubmitEvent extends Event {}

    try {
      globalRecord.__kovoInlineImport = importModule;
      globalRecord.addEventListener = (type: string, listener: unknown) => {
        listeners.set(type, listener);
      };
      globalRecord.removeEventListener = () => {};
      globalRecord.requestAnimationFrame = (callback: Function) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      };
      globalRecord.HTMLFormElement = FakeHTMLFormElement;
      globalRecord.MouseEvent = FakeMouseEvent;
      globalRecord.SubmitEvent = FakeSubmitEvent;
      globalRecord.document = {
        createElement(name: string) {
          return name === 'form' ? new FakeHTMLFormElement() : new EventTarget();
        },
        querySelectorAll() {
          return [];
        },
      };
      globalRecord.location = { href: 'http://app.test/' };

      runInThisContext(createInlineKovoLoaderSource(' globalThis.__kovoInlineImport '));

      expect([...listeners.keys()]).toEqual(['click', 'submit']);
      expect(rafCallbacks).toHaveLength(2);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
        HTMLFormElement: originals.htmlFormElement,
        location: originals.location,
        MouseEvent: originals.mouseEvent,
        removeEventListener: originals.removeEventListener,
        requestAnimationFrame: originals.requestAnimationFrame,
        SubmitEvent: originals.submitEvent,
      });
      if (originals.importModule === undefined) {
        delete globalRecord.__kovoInlineImport;
      } else {
        globalRecord.__kovoInlineImport = originals.importModule;
      }
    }
  });
});
