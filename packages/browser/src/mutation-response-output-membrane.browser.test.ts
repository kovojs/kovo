import { afterEach, describe, expect, it } from 'vitest';

import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { installInlineKovoLoader } from './inline-loader.js';
import { DomMorphRoot } from './morph.js';
import { createQueryStore } from './query-store.js';

const nativeArrayFrom = Array.from;
const nativeArrayMap = Array.prototype.map;
const nativeDocumentCreateElement = Document.prototype.createElement;
const nativeDocumentQuerySelector = Document.prototype.querySelector;
const nativeElementQuerySelectorAll = Element.prototype.querySelectorAll;
const nativeElementSetAttribute = Element.prototype.setAttribute;
const nativeHtmlCollectionIterator = HTMLCollection.prototype[Symbol.iterator];
const nativeNodeAppendChild = Node.prototype.appendChild;
const nativeRegExpExec = RegExp.prototype.exec;
const nativeStringToLowerCase = String.prototype.toLowerCase;

type FindingGlobal = typeof globalThis & {
  __kovo_plan_xss?: number;
  __kovo_sanitize_xss?: number;
  __kovo_template_xss?: number;
};

afterEach(() => {
  Array.from = nativeArrayFrom;
  Array.prototype.map = nativeArrayMap;
  Document.prototype.createElement = nativeDocumentCreateElement;
  Document.prototype.querySelector = nativeDocumentQuerySelector;
  Element.prototype.querySelectorAll = nativeElementQuerySelectorAll;
  Element.prototype.setAttribute = nativeElementSetAttribute;
  HTMLCollection.prototype[Symbol.iterator] = nativeHtmlCollectionIterator;
  RegExp.prototype.exec = nativeRegExpExec;
  String.prototype.toLowerCase = nativeStringToLowerCase;
  document.body.replaceChildren();
  delete (globalThis as FindingGlobal).__kovo_plan_xss;
  delete (globalThis as FindingGlobal).__kovo_sanitize_xss;
  delete (globalThis as FindingGlobal).__kovo_template_xss;
});

function createNativeElement<K extends keyof HTMLElementTagNameMap>(
  name: K,
): HTMLElementTagNameMap[K] {
  return Reflect.apply(nativeDocumentCreateElement, document, [name]) as HTMLElementTagNameMap[K];
}

function setNativeAttribute(element: Element, name: string, value: string): void {
  Reflect.apply(nativeElementSetAttribute, element, [name, value]);
}

function appendNative(parent: Node, child: Node): void {
  Reflect.apply(nativeNodeAppendChild, parent, [child]);
}

function executableImage(globalName: keyof FindingGlobal, marker: string): HTMLImageElement {
  // C108 / SPEC §6.6 rule 5: the intentionally broken source makes an adopted
  // `onerror` observable; it is an adversarial security fixture, not product UI.
  const image = createNativeElement('img');
  setNativeAttribute(image, 'data-attacker', marker);
  setNativeAttribute(image, 'onerror', `if(this.isConnected)globalThis.${String(globalName)}=1`);
  setNativeAttribute(image, 'src', 'data:image/png;base64,!');
  return image;
}

function executableScript(globalName: keyof FindingGlobal, marker: string): HTMLScriptElement {
  const script = createNativeElement('script');
  setNativeAttribute(script, 'data-attacker', marker);
  script.textContent = `globalThis.${String(globalName)}=1`;
  return script;
}

function makeTarget(name: string): HTMLElement {
  const target = createNativeElement('main');
  setNativeAttribute(target, 'kovo-fragment-target', name);
  target.innerHTML = '<span kovo-key="old">old</span>';
  appendNative(document.body, target);
  return target;
}

function applyModular(name: string, mode: '' | 'append' | 'prepend', html: string): void {
  const modeAttribute = mode ? ` mode="${mode}"` : '';
  applyMutationResponseBodyToRuntime({
    body: `<kovo-fragment target="${name}"${modeAttribute}>${html}</kovo-fragment>`,
    root: new DomMorphRoot(document),
    store: createQueryStore(),
  });
}

function applyInline(name: string, mode: '' | 'append' | 'prepend', html: string): void {
  const modeAttribute = mode ? ` mode="${mode}"` : '';
  (globalThis as { __kovo_a?: (body: string) => void }).__kovo_a?.(
    `<kovo-fragment target="${name}"${modeAttribute}>${html}</kovo-fragment>`,
  );
}

function containsServerMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const length = Number((value as { length?: unknown }).length);
  if (!Number.isSafeInteger(length) || length < 0 || length > 100) return false;
  for (let index = 0; index < length; index += 1) {
    const entry = (value as { [key: number]: unknown })[index];
    if (entry instanceof Element && entry.hasAttribute('data-server-safe')) return true;
  }
  return false;
}

function installArrayFromPlanSubstitution(attacker: Node): void {
  Array.from = function poisonedArrayFrom(value: unknown, map?: unknown, thisArg?: unknown) {
    if (containsServerMarker(value)) {
      Array.from = nativeArrayFrom;
      return [attacker];
    }
    return Reflect.apply(nativeArrayFrom, Array, [value, map, thisArg]);
  } as typeof Array.from;
}

function installArrayMapPlanSubstitution(attacker: Node): void {
  Array.prototype.map = function poisonedArrayMap(callback: unknown, thisArg?: unknown) {
    if (containsServerMarker(this)) {
      Array.prototype.map = nativeArrayMap;
      return [attacker];
    }
    return Reflect.apply(nativeArrayMap, this, [callback, thisArg]);
  } as typeof Array.prototype.map;
}

function installHtmlCollectionPlanSubstitution(attacker: Element): void {
  HTMLCollection.prototype[Symbol.iterator] = function poisonedIterator() {
    if (containsServerMarker(this)) {
      HTMLCollection.prototype[Symbol.iterator] = nativeHtmlCollectionIterator;
      return [attacker][Symbol.iterator]();
    }
    return Reflect.apply(nativeHtmlCollectionIterator, this, []);
  };
}

function installAttributeSnapshotOmission(): void {
  Array.from = function poisonedArrayFrom(value: unknown, map?: unknown, thisArg?: unknown) {
    if (value instanceof NamedNodeMap) {
      for (let index = 0; index < value.length; index += 1) {
        if (value[index]?.name.toLowerCase() === 'onerror') {
          Array.from = nativeArrayFrom;
          return [];
        }
      }
    }
    return Reflect.apply(nativeArrayFrom, Array, [value, map, thisArg]);
  } as typeof Array.from;
}

function installDescendantTraversalOmission(): void {
  Element.prototype.querySelectorAll = function poisonedQuerySelectorAll(selectors: string) {
    if (selectors === '*' && this.hasAttribute('data-server-root')) {
      Element.prototype.querySelectorAll = nativeElementQuerySelectorAll;
      return createNativeElement('div').querySelectorAll('*');
    }
    return Reflect.apply(nativeElementQuerySelectorAll, this, [selectors]);
  } as typeof Element.prototype.querySelectorAll;
}

function installTemplateContentSwap(attacker: Node): void {
  const malicious = document.createDocumentFragment();
  const safe = document.createDocumentFragment();
  appendNative(malicious, attacker);
  const safeNode = createNativeElement('span');
  setNativeAttribute(safeNode, 'data-sanitized-decoy', 'true');
  appendNative(safe, safeNode);

  Document.prototype.createElement = function poisonedCreateElement(localName: string) {
    if (this === document && localName.toLowerCase() === 'template') {
      Document.prototype.createElement = nativeDocumentCreateElement;
      let reads = 0;
      return {
        set innerHTML(_value: unknown) {},
        get content() {
          reads += 1;
          return reads === 1 ? malicious : safe;
        },
      } as unknown as HTMLTemplateElement;
    }
    return Reflect.apply(nativeDocumentCreateElement, this, [localName]);
  } as typeof Document.prototype.createElement;
}

function installSanitizerSetAttributeMutation(): void {
  Element.prototype.setAttribute = function poisonedSetAttribute(
    name: string,
    value: string,
  ): void {
    if (
      name.toLowerCase() === 'alt' &&
      value === 'server-safe' &&
      this instanceof HTMLImageElement
    ) {
      Element.prototype.setAttribute = nativeElementSetAttribute;
      setNativeAttribute(this, 'onerror', 'globalThis.__kovo_sanitize_xss=1');
      setNativeAttribute(this, 'src', 'data:image/png;base64,!');
    }
    Reflect.apply(nativeElementSetAttribute, this, [name, value]);
  };
}

function installOneShotLowerCaseSubstitution(target: string, substitute: string): void {
  String.prototype.toLowerCase = function poisonedToLowerCase(): string {
    const lowered = Reflect.apply(nativeStringToLowerCase, this, []);
    if (lowered === target) {
      String.prototype.toLowerCase = nativeStringToLowerCase;
      return substitute;
    }
    return lowered;
  };
}

function installOneShotRegExpExecOmission(target: string): void {
  RegExp.prototype.exec = function poisonedExec(value: string): RegExpExecArray | null {
    if (value === target) {
      RegExp.prototype.exec = nativeRegExpExec;
      return null;
    }
    return Reflect.apply(nativeRegExpExec, this, [value]);
  };
}

async function expectInert(name: keyof FindingGlobal): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect((globalThis as FindingGlobal)[name]).toBeUndefined();
}

describe('browser mutation-response output membrane', () => {
  // C108 / SPEC §6.6 rule 5 and §9.1: source and generated mutation morphs must
  // consume one boot-pinned template/traversal/attribute/adoption membrane.
  for (const runtime of ['modular', 'inline'] as const) {
    const apply = runtime === 'modular' ? applyModular : applyInline;

    it(`${runtime}: pins append collection snapshots before authored Array.from replacement`, async () => {
      const name = `${runtime}-append-array`;
      const target = makeTarget(name);
      const attacker = executableImage('__kovo_plan_xss', `${runtime}-append-array`);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installArrayFromPlanSubstitution(attacker);

      apply(name, 'append', '<span data-server-safe>server safe</span>');

      expect(target.querySelector(`[data-attacker="${runtime}-append-array"]`)).toBeNull();
      expect(target.querySelector('[data-server-safe]')?.textContent).toBe('server safe');
      await expectInert('__kovo_plan_xss');
    });

    it(`${runtime}: pins template creation before authored Document.createElement replacement`, async () => {
      const name = `${runtime}-append-template`;
      const target = makeTarget(name);
      const attacker = executableImage('__kovo_template_xss', `${runtime}-append-template`);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installTemplateContentSwap(attacker);

      apply(name, 'append', '<span data-server-safe>server safe</span>');

      expect(target.querySelector(`[data-attacker="${runtime}-append-template"]`)).toBeNull();
      expect(target.querySelector('[data-server-safe]')?.textContent).toBe('server safe');
      await expectInert('__kovo_template_xss');
    });

    it(`${runtime}: pins sanitizer attribute snapshots before authored Array.from replacement`, async () => {
      const name = `${runtime}-replace-attributes`;
      makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installAttributeSnapshotOmission();

      apply(
        name,
        '',
        `<img kovo-fragment-target="${name}" data-attacker="${runtime}-replace-attributes" onerror="globalThis.__kovo_plan_xss=1" src="data:image/png;base64,!">`,
      );

      expect(
        document
          .querySelector(`[data-attacker="${runtime}-replace-attributes"]`)
          ?.getAttribute('onerror'),
      ).toBeNull();
      await expectInert('__kovo_plan_xss');
    });

    it(`${runtime}: pins sanitizer traversal before authored querySelectorAll replacement`, async () => {
      const name = `${runtime}-replace-descendant`;
      makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installDescendantTraversalOmission();

      apply(
        name,
        '',
        `<section kovo-fragment-target="${name}" data-server-root><img data-attacker="${runtime}-replace-descendant" onerror="globalThis.__kovo_plan_xss=1" src="data:image/png;base64,!"></section>`,
      );

      expect(
        document
          .querySelector(`[data-attacker="${runtime}-replace-descendant"]`)
          ?.getAttribute('onerror'),
      ).toBeNull();
      await expectInert('__kovo_plan_xss');
    });

    it(`${runtime}: pins the reconciled child plan before authored Array.map replacement`, async () => {
      const name = `${runtime}-replace-map`;
      const target = makeTarget(name);
      const attacker = executableScript('__kovo_plan_xss', `${runtime}-replace-map`);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installArrayMapPlanSubstitution(attacker);

      apply(
        name,
        '',
        `<main kovo-fragment-target="${name}"><span data-server-safe>server safe</span></main>`,
      );

      expect(target.querySelector(`[data-attacker="${runtime}-replace-map"]`)).toBeNull();
      expect(target.querySelector('[data-server-safe]')?.textContent).toBe('server safe');
      await expectInert('__kovo_plan_xss');
    });

    it(`${runtime}: pins sanitizer writes before authored setAttribute replacement`, async () => {
      const name = `${runtime}-append-setattribute`;
      const target = makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installSanitizerSetAttributeMutation();

      apply(
        name,
        'append',
        '<img data-server-safe alt="server-safe" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
      );

      expect(target.querySelector('img')?.getAttribute('onerror')).toBeNull();
      expect(target.querySelector('img')?.getAttribute('alt')).toBe('server-safe');
      await expectInert('__kovo_sanitize_xss');
    });

    it(`${runtime}: pins event-attribute normalization before authored lowercase replacement`, async () => {
      const name = `${runtime}-replace-event-lowercase`;
      makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installOneShotLowerCaseSubstitution('onerror', 'data-attacker-safe');

      apply(
        name,
        '',
        `<img kovo-fragment-target="${name}" data-server-safe onerror="if(this.isConnected)globalThis.__kovo_sanitize_xss=1" src="data:image/png;base64,!">`,
      );

      expect(document.querySelector('[data-server-safe]')?.getAttribute('onerror')).toBeNull();
      await expectInert('__kovo_sanitize_xss');
    });

    it(`${runtime}: pins URL-scheme normalization before authored lowercase replacement`, () => {
      const name = `${runtime}-replace-url-lowercase`;
      makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installOneShotLowerCaseSubstitution('javascript:alert(1)', 'https://safe.invalid/');

      apply(
        name,
        '',
        `<a kovo-fragment-target="${name}" data-server-safe href="JaVaScRiPt:alert(1)">safe</a>`,
      );

      expect(document.querySelector('[data-server-safe]')?.getAttribute('href')).toBe('#');
    });

    it(`${runtime}: pins CSS URL parsing before authored RegExp.exec replacement`, () => {
      const name = `${runtime}-replace-css-regexp`;
      const style = 'background-image: url("javascript:alert(1)")';
      makeTarget(name);
      if (runtime === 'inline') installInlineKovoLoader(async () => ({}));
      installOneShotRegExpExecOmission(style);

      apply(
        name,
        '',
        `<section kovo-fragment-target="${name}" data-server-safe style='${style}'>safe</section>`,
      );

      expect(document.querySelector('[data-server-safe]')?.getAttribute('style')).toBeNull();
    });
  }

  it('modular: pins prepend collection snapshots before authored iterator replacement', async () => {
    const name = 'modular-prepend-iterator';
    const target = makeTarget(name);
    const attacker = executableImage('__kovo_plan_xss', name);
    setNativeAttribute(attacker, 'kovo-key', 'attacker');
    installHtmlCollectionPlanSubstitution(attacker);

    applyModular(name, 'prepend', '<span data-server-safe kovo-key="server">server safe</span>');

    expect(target.firstElementChild?.getAttribute('data-server-safe')).not.toBeNull();
    expect(target.querySelector('[data-attacker]')).toBeNull();
    await expectInert('__kovo_plan_xss');
  });

  it('inline: pins prepend collection snapshots before authored iterator replacement', async () => {
    const name = 'inline-prepend-iterator';
    const target = makeTarget(name);
    const attacker = executableImage('__kovo_plan_xss', name);
    setNativeAttribute(attacker, 'kovo-key', 'attacker');
    installInlineKovoLoader(async () => ({}));
    installHtmlCollectionPlanSubstitution(attacker);

    applyInline(name, 'prepend', '<span data-server-safe kovo-key="server">server safe</span>');

    expect(target.firstElementChild?.getAttribute('data-server-safe')).not.toBeNull();
    expect(target.querySelector('[data-attacker]')).toBeNull();
    await expectInert('__kovo_plan_xss');
  });

  it('modular: pins fragment-target lookup before authored querySelector replacement', () => {
    const name = 'modular-fragment-target-query';
    const target = makeTarget(name);
    target.textContent = 'PRIVILEGED';
    const decoy = createNativeElement('main');
    decoy.textContent = 'DECOY';
    appendNative(document.body, decoy);

    Document.prototype.querySelector = function poisonedQuerySelector(selector: string) {
      if (selector === `[kovo-fragment-target="${name}"]`) return decoy;
      return Reflect.apply(nativeDocumentQuerySelector, this, [selector]);
    } as typeof Document.prototype.querySelector;

    applyModular(name, '', `<main kovo-fragment-target="${name}">ACCESS-REVOKED</main>`);

    expect(target.textContent).toBe('ACCESS-REVOKED');
    expect(decoy.textContent).toBe('DECOY');
  });
});
