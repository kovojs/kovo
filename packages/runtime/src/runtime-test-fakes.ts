import type { DelegatedEvent, EventElementLike } from './index.js';

export class FakeRoot {
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

  querySelectorAll(selector: string): Iterable<QueryScript | FakeElement> {
    return selector === 'script[fw-query]' ? this.scripts : (this.elements.get(selector) ?? []);
  }
}

export interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

export class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string>) {
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
  method: string | undefined;
  progressElements: FakeElement[] = [];

  constructor(attributes: Record<string, string>, options: { action: string; method?: string }) {
    super(attributes);
    this.action = options.action;
    this.method = options.method;
  }

  querySelectorAll(selector: string): Iterable<FakeElement> {
    return selector === '[fw-upload-progress]' ? this.progressElements : [];
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
  deps: { deps?: string; id?: string; target?: string }[] = [];
  planElements: FakeQueryPlanElement[] = [];
  targets = new Map<string, FakeMorphTarget>();

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
    if (_selector === '[data-bind]') return this.bindings;
    if (_selector === '*') return [...this.bindings, ...this.planElements];
    const planElements = this.planElements.filter((element) => element.matches(_selector));
    if (planElements.length > 0) return planElements;

    return this.deps.map((dep) => ({
      getAttribute: (name) => {
        if (name === 'fw-fragment-target') return dep.target ?? null;
        if (name === 'fw-deps') return dep.deps ?? null;
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
  textContent: string | null;
  value?: string;

  constructor(
    private readonly path: string,
    options: { textContent?: string | null; value?: string } = {},
  ) {
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) {
      this.value = options.value;
    }
  }

  getAttribute(name: string): string | null {
    return name === 'data-bind' ? this.path : null;
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
