import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createInlineKovoLoaderSource } from './inline-loader.js';

describe('inline loader source', () => {
  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      documentConstructor: globalRecord.Document,
      element: globalRecord.Element,
      htmlFormElement: globalRecord.HTMLFormElement,
      importModule: globalRecord.__kovoInlineImport,
      location: globalRecord.location,
      mouseEvent: globalRecord.MouseEvent,
      node: globalRecord.Node,
      nodeList: globalRecord.NodeList,
      removeEventListener: globalRecord.removeEventListener,
      requestAnimationFrame: globalRecord.requestAnimationFrame,
      submitEvent: globalRecord.SubmitEvent,
    };
    const listeners = new Map<string, unknown>();
    const rafCallbacks: Function[] = [];
    const importModule = vi.fn(async () => ({}));
    class FakeElement extends EventTarget {
      get isConnected(): boolean {
        return false;
      }

      closest(selector: string): FakeElement | null {
        return selector === 'button' ? this : null;
      }

      getAttribute(): null {
        return null;
      }

      hasAttribute(): boolean {
        return false;
      }

      remove(): void {}

      removeAttribute(): void {}

      setAttribute(): void {}
    }

    class FakeNodeList {
      get length(): number {
        return 0;
      }

      item(): null {
        return null;
      }
    }
    class FakeDocument {
      createElement(name: string): FakeElement {
        return name === 'form' ? new FakeHTMLFormElement() : new FakeElement();
      }

      querySelectorAll(): FakeNodeList {
        return new FakeNodeList();
      }
    }
    class FakeHTMLFormElement extends FakeElement {
      submit(): void {
        if (!(this instanceof FakeHTMLFormElement)) throw new TypeError('invalid form receiver');
      }
    }
    class FakeMouseEvent extends Event {
      get altKey(): boolean {
        return false;
      }

      get button(): number {
        return 0;
      }

      get ctrlKey(): boolean {
        return false;
      }

      get metaKey(): boolean {
        return false;
      }

      get shiftKey(): boolean {
        return false;
      }
    }
    class FakeSubmitEvent extends Event {
      get submitter(): null {
        return null;
      }
    }
    class FakeLocation {
      #url = new URL('http://app.test/');

      get href(): string {
        return this.#url.href;
      }

      get origin(): string {
        return this.#url.origin;
      }

      get pathname(): string {
        return this.#url.pathname;
      }

      get search(): string {
        return this.#url.search;
      }

      assign(url: string): void {
        this.#url = new URL(url, this.#url);
      }
    }

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
      globalRecord.Element = FakeElement;
      globalRecord.Document = FakeDocument;
      globalRecord.HTMLFormElement = FakeHTMLFormElement;
      globalRecord.MouseEvent = FakeMouseEvent;
      globalRecord.Node = FakeElement;
      globalRecord.NodeList = FakeNodeList;
      globalRecord.SubmitEvent = FakeSubmitEvent;
      globalRecord.document = new FakeDocument();
      globalRecord.location = new FakeLocation();

      runInThisContext(createInlineKovoLoaderSource(' globalThis.__kovoInlineImport '));

      expect([...listeners.keys()]).toEqual(['click', 'submit']);
      expect(rafCallbacks).toHaveLength(2);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
        Document: originals.documentConstructor,
        Element: originals.element,
        HTMLFormElement: originals.htmlFormElement,
        location: originals.location,
        MouseEvent: originals.mouseEvent,
        Node: originals.node,
        NodeList: originals.nodeList,
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
