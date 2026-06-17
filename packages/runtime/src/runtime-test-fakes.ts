import type { DelegatedEvent, EventElementLike } from './index.js';

export class FakeRoot {
  bindings: FakeQueryBindingElement[] = [];
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
  elements = new Map<string, FakeElement[]>();
  scripts: QueryScript[] = [];
  visibilityState: 'hidden' | 'visible' = 'visible';

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
  ): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(
    selector: string,
  ): Iterable<QueryScript | FakeElement | FakeQueryBindingElement> {
    if (selector === 'script[kovo-query]') return this.scripts;
    if (selector === '[data-bind]') return this.bindings;
    if (selector === '*') return this.bindings;

    return this.elements.get(selector) ?? [];
  }
}

export interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

export class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string> = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(_selector: string): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

export class FakeFormElement extends FakeElement {
  action: string;
  method?: string;
  progressElements: FakeElement[] = [];
  submitted = false;

  constructor(attributes: Record<string, string>, options: { action: string; method?: string }) {
    super(attributes);
    this.action = options.action;
    if (options.method !== undefined) {
      this.method = options.method;
    }
  }

  querySelectorAll(selector: string): Iterable<FakeElement> {
    return selector === '[kovo-upload-progress]' ? this.progressElements : [];
  }

  submit(): void {
    this.submitted = true;
  }
}

export class FakeBroadcastChannel {
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly hub?: FakeBroadcastHub) {
    hub?.connect(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    this.hub?.deliver(this, message);
  }

  close(): void {
    this.closed = true;
  }
}

export class FakeBroadcastHub {
  private readonly channels = new Set<FakeBroadcastChannel>();

  connect(channel: FakeBroadcastChannel): void {
    this.channels.add(channel);
  }

  deliver(sender: FakeBroadcastChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel === sender) continue;
      channel.onmessage?.({ data: message });
    }
  }
}

export class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }

  appendHtml(html: string): void {
    this.html += html;
  }

  readHtml(): string {
    return this.html;
  }
}

export class FakeMorphRoot {
  bindings: FakeQueryBindingElement[] = [];
  deps: {
    component?: string;
    deps?: string;
    id?: string;
    props?: string;
    target?: string;
  }[] = [];
  planElements: FakeQueryPlanElement[] = [];
  targets = new Map<string, FakeMorphTarget>();
  wildcardSelectorCalls = 0;

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(_selector: string): Iterable<
    | FakeQueryBindingElement
    | FakeQueryPlanElement
    | {
        getAttribute(name: string): string | null;
        id?: string;
      }
  > {
    if (_selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (_selector === '*') {
      this.wildcardSelectorCalls += 1;
      return [...this.bindings, ...this.planElements];
    }
    const queryElements = [...this.bindings, ...this.planElements].filter((element) =>
      element.matches(_selector),
    );
    if (queryElements.length > 0) return queryElements;

    return this.deps.map((dep) => ({
      getAttribute: (name) => {
        if (name === 'kovo-fragment-target') return dep.target ?? null;
        if (name === 'kovo-live-component') return dep.component ?? null;
        if (name === 'kovo-props') return dep.props ?? null;
        if (name === 'kovo-deps') return dep.deps ?? null;
        if (name === 'kovo-c') return dep.component ?? null;
        return null;
      },
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}

export class FakeQueryPlanElement {
  attributes: { name: string; value: string }[];
  textContent: string | null;
  value?: string;

  constructor(
    attributes: Record<string, string>,
    options: { textContent?: string | null; value?: string } = {},
  ) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) {
      this.value = options.value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

export class FakeTemplateStampHost extends FakeQueryPlanElement {
  items: Array<{ html: string; index: number; key: string; value: unknown }> = [];

  reconcileTemplateStamp(
    items: readonly { html: string; index: number; key: string; value: unknown }[],
  ): void {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

export class FakeQueryBindingElement {
  attributes: { name: string; value: string }[];
  checked?: boolean;
  indeterminate?: boolean;
  scrollLeft?: number;
  scrollTop?: number;
  textContent: string | null;
  value?: string;

  constructor(
    pathOrAttributes: string | Record<string, string>,
    options:
      | {
          checked?: boolean;
          indeterminate?: boolean;
          scrollLeft?: number;
          scrollTop?: number;
          textContent?: string | null;
          value?: string;
        }
      | string = {},
  ) {
    this.attributes =
      typeof pathOrAttributes === 'string'
        ? [{ name: 'data-bind', value: pathOrAttributes }]
        : Object.entries(pathOrAttributes).map(([name, value]) => ({ name, value }));
    const normalizedOptions = typeof options === 'string' ? { textContent: options } : options;
    this.textContent = normalizedOptions.textContent ?? null;
    if (normalizedOptions.checked !== undefined) {
      this.checked = normalizedOptions.checked;
    }
    if (normalizedOptions.indeterminate !== undefined) {
      this.indeterminate = normalizedOptions.indeterminate;
    }
    if (normalizedOptions.scrollLeft !== undefined) {
      this.scrollLeft = normalizedOptions.scrollLeft;
    }
    if (normalizedOptions.scrollTop !== undefined) {
      this.scrollTop = normalizedOptions.scrollTop;
    }
    if (normalizedOptions.value !== undefined) {
      this.value = normalizedOptions.value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

export class FakeStatefulBindingElement extends FakeQueryBindingElement {
  readonly children: FakeStatefulBindingElement[] = [];
  private readonly parent: FakeStatefulBindingElement | null;

  constructor(
    attributes: Record<string, string>,
    options: {
      checked?: boolean;
      indeterminate?: boolean;
      parent?: FakeStatefulBindingElement;
      scrollLeft?: number;
      scrollTop?: number;
      textContent?: string | null;
      value?: string;
    } = {},
  ) {
    super(attributes, options);
    this.parent = options.parent ?? null;
    options.parent?.children.push(this);
  }

  closest(selector: string): FakeStatefulBindingElement | null {
    if (selector === '[kovo-state]') return this.closestAttribute('kovo-state');

    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    if (trigger) return this.closestAttribute(`on:${trigger}`);

    return null;
  }

  querySelectorAll(selector: string): Iterable<FakeStatefulBindingElement> {
    return this.descendants().filter((element) => {
      if (selector === '*') return true;
      if (selector === '[data-bind]') return element.getAttribute('data-bind') !== null;

      return element.matches(selector);
    });
  }

  private closestAttribute(name: string): FakeStatefulBindingElement | null {
    if (this.getAttribute(name) !== null) return this;

    return this.parent?.closestAttribute(name) ?? null;
  }

  private descendants(): FakeStatefulBindingElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

export class FakePendingElement {
  attributes: Record<string, string>;

  constructor(attributes: Record<string, string>) {
    this.attributes = { ...attributes };
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

export class FakePendingRoot {
  constructor(readonly elements: FakePendingElement[]) {}

  querySelectorAll(_selector: string): Iterable<FakePendingElement> {
    return this.elements;
  }
}
