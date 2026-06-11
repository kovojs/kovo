import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyMutationResponseToDom,
  createQueryStore,
  installJisoLoader,
  type MorphFragment,
  type MorphRoot,
  type MorphTarget,
} from './index.js';

class DomFragmentTarget implements MorphTarget {
  constructor(public element: Element) {}

  readHtml(): string {
    return this.element.innerHTML;
  }

  appendHtml(html: string): void {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    this.element.append(...Array.from(template.content.childNodes));
  }

  replaceWithHtml(html: string): void {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const next = template.content.firstElementChild;
    const activeState = captureActiveState(this.element);
    const scrollStates = captureScrollStates(this.element);

    if (!next) {
      this.element.replaceChildren();
      return;
    }

    morphElement(this.element, next);
    restoreActiveState(activeState);
    restoreScrollStates(scrollStates);
  }
}

class DomFragmentRoot implements MorphRoot {
  constructor(private readonly root: ParentNode) {}

  findFragmentTarget(target: string): MorphTarget | null {
    const element = this.root.querySelector(`[fw-c="${CSS.escape(target)}"]`);

    return element ? new DomFragmentTarget(element) : null;
  }
}

const keyedDomMorph: MorphFragment = (target, html) => {
  target.replaceWithHtml(html);
};

function morphElement(current: Element, next: Element): Element {
  if (!canReuse(current, next)) {
    current.replaceWith(next);
    return next;
  }

  syncAttributes(current, next);
  if (isActiveFormControl(current)) {
    return current;
  }

  morphChildren(current, next);
  return current;
}

function canReuse(current: Element, next: Element): boolean {
  const currentKey = morphKey(current);
  const nextKey = morphKey(next);

  return current.tagName === next.tagName && currentKey === nextKey;
}

function morphKey(element: Element): string | null {
  return element.getAttribute('fw-key') ?? element.getAttribute('data-key');
}

function syncAttributes(current: Element, next: Element): void {
  for (const name of Array.from(current.attributes, (attribute) => attribute.name)) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }

  for (const attribute of next.attributes) {
    current.setAttribute(attribute.name, attribute.value);
  }
}

function isActiveFormControl(element: Element): boolean {
  return (
    document.activeElement === element &&
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
  );
}

function captureActiveState(root: Element) {
  const element = document.activeElement;

  if (
    !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
    !root.contains(element)
  ) {
    return null;
  }

  return {
    element,
    selectionDirection: element.selectionDirection,
    selectionEnd: element.selectionEnd,
    selectionStart: element.selectionStart,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

function restoreActiveState(state: ReturnType<typeof captureActiveState>): void {
  if (!state || !state.element.isConnected) return;

  state.element.focus();
  if (state.selectionStart !== null && state.selectionEnd !== null) {
    state.element.setSelectionRange(
      state.selectionStart,
      state.selectionEnd,
      state.selectionDirection ?? 'none',
    );
  }
  state.element.scrollLeft = state.scrollLeft;
  state.element.scrollTop = state.scrollTop;
}

function captureScrollStates(root: Element) {
  return [...root.querySelectorAll<HTMLElement>('[fw-key], [data-key]')]
    .filter((element) => element.scrollLeft !== 0 || element.scrollTop !== 0)
    .map((element) => ({
      element,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    }));
}

function restoreScrollStates(states: ReturnType<typeof captureScrollStates>): void {
  for (const state of states) {
    if (!state.element.isConnected) continue;

    state.element.scrollLeft = state.scrollLeft;
    state.element.scrollTop = state.scrollTop;
  }
}

function morphChildren(current: Element, next: Element): void {
  const currentByKey = new Map(
    [...current.children]
      .map((child) => [morphKey(child), child] as const)
      .filter((entry): entry is [string, Element] => entry[0] !== null),
  );
  const nextChildren = [...next.childNodes];
  const desiredNodes: ChildNode[] = [];

  for (const [index, nextChild] of nextChildren.entries()) {
    let desiredNode: ChildNode;
    if (!(nextChild instanceof Element)) {
      desiredNode = nextChild.cloneNode(true) as ChildNode;
    } else {
      const key = morphKey(nextChild);
      const existing = key ? currentByKey.get(key) : undefined;
      desiredNode = existing
        ? morphElement(existing, nextChild)
        : (nextChild.cloneNode(true) as ChildNode);
    }

    desiredNodes.push(desiredNode);
    current.insertBefore(desiredNode, current.childNodes[index] ?? null);
  }

  for (const child of Array.from(current.childNodes)) {
    if (!desiredNodes.includes(child)) child.remove();
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('runtime browser suite', () => {
  it('keeps the loader idle until the first delegated interaction', async () => {
    const root = document.createElement('main');
    root.innerHTML =
      '<button fw-state="{&quot;count&quot;:0}" on:click="/handlers/cart.js#increment" data-p-product-id="p1">Add</button>';
    document.body.append(root);
    const button = root.querySelector('button');
    let imports = 0;

    installJisoLoader({
      async importModule(url) {
        imports += 1;
        expect(url).toBe('/handlers/cart.js');

        return {
          increment(_event: Event, ctx: { state: { count: number } }) {
            ctx.state.count += 1;
          },
        };
      },
      root,
    });

    expect(imports).toBe(0);

    button?.click();

    await vi.waitFor(() => {
      expect(imports).toBe(1);
      expect(button?.getAttribute('fw-state')).toBe('{"count":1}');
    });
  });

  it('preserves L0 light-DOM IDREF and form behavior without handler imports', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<cart-filter fw-c="cart-filter">',
      '<form id="filters">',
      '<label for="query">Search</label>',
      '<input id="query" name="query" value="coffee">',
      '<button type="submit">Apply</button>',
      '</form>',
      '</cart-filter>',
    ].join('');
    document.body.append(root);
    let imports = 0;

    installJisoLoader({
      async importModule() {
        imports += 1;
        return {};
      },
      root,
    });

    root.querySelector('label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(root.querySelector('#query'));
    });

    const form = root.querySelector('form');
    if (!form) throw new Error('missing form fixture');

    expect(new FormData(form).get('query')).toBe('coffee');
    expect(imports).toBe(0);
  });

  it('preserves L0 popover behavior without handler imports', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<button popovertarget="filters" popovertargetaction="toggle">Filters</button>',
      '<section id="filters" popover>Filter controls</section>',
    ].join('');
    document.body.append(root);
    let imports = 0;

    installJisoLoader({
      async importModule() {
        imports += 1;
        return {};
      },
      root,
    });

    const button = root.querySelector('button');
    const popover = root.querySelector<HTMLElement>('#filters');
    if (!button || !popover) throw new Error('missing popover fixture');

    expect(popover.matches(':popover-open')).toBe(false);

    button.click();

    await vi.waitFor(() => {
      expect(popover.matches(':popover-open')).toBe(true);
    });
    expect(imports).toBe(0);
  });

  it('preserves focus, selection, scroll, and keyed identity during a real DOM fragment morph', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form fw-c="cart-form">',
      '<label fw-key="label">Quantity</label>',
      '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea fw-key="quantity" name="quantity">12345</textarea>',
      '</form>',
    ].join('');
    document.body.append(root);
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[fw-key="panel"]');

    if (!textarea || !panel) throw new Error('missing browser fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const applied = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="cart-form">',
        '<form fw-c="cart-form">',
        '<textarea fw-key="quantity" name="quantity">67890</textarea>',
        '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
        '<label fw-key="label">Updated quantity</label>',
        '</form>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomFragmentRoot(root),
      store: createQueryStore(),
    });
    const nextTextarea = root.querySelector('textarea');

    expect(applied.appliedFragments).toEqual(['cart-form']);
    expect(nextTextarea).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector<HTMLDivElement>('[fw-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
    expect(root.querySelector('label')?.textContent).toBe('Updated quantity');
  });

  it('appends real DOM fragments without replacing keyed list nodes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section fw-c="product-grid">',
      '<article fw-key="p1"><input value="keep"></article>',
      '<article fw-key="p2">Second</article>',
      '</section>',
    ].join('');
    document.body.append(root);
    const grid = root.querySelector('[fw-c="product-grid"]');
    const first = root.querySelector('[fw-key="p1"]');
    const second = root.querySelector('[fw-key="p2"]');
    const input = root.querySelector('input');

    if (!grid || !first || !second || !input) throw new Error('missing append fixture');

    input.focus();

    const appendResult = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid" mode="append">',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p4">Fourth</article>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomFragmentRoot(root),
      store: createQueryStore(),
    });

    expect(appendResult.appliedFragments).toEqual(['product-grid']);
    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect(document.activeElement).toBe(input);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);

    applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid">',
        '<section fw-c="product-grid">',
        '<article fw-key="p4">Fourth updated</article>',
        '<article fw-key="p1"><input value="keep"></article>',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p2">Second</article>',
        '</section>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomFragmentRoot(root),
      store: createQueryStore(),
    });

    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p4',
      'p1',
      'p3',
      'p2',
    ]);
  });
});
