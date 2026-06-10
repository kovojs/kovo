export type { DiagnosticCode } from '@jiso/core';

export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export interface HandlerContext<State = unknown, Params = Record<string, string>> {
  params: Params;
  state: State;
}

export type ClientHandler<State = unknown, Params = Record<string, string>> = (
  event: Event,
  ctx: HandlerContext<State, Params>,
) => void | Promise<void>;

export function handler<State = unknown, Params = Record<string, string>>(
  fn: ClientHandler<State, Params>,
): ClientHandler<State, Params> {
  return fn;
}

export interface LoaderRoot {
  addEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
}

export interface DelegatedEvent {
  type: string;
  target: EventTargetLike | null;
}

export interface EventTargetLike {
  closest?: (selector: string) => EventElementLike | null;
}

export interface EventElementLike {
  getAttribute(name: string): string | null;
  attributes?: Iterable<{ name: string; value: string }>;
}

export interface JisoLoaderOptions {
  events?: readonly string[];
  importModule: ImportHandlerModule;
  root: LoaderRoot;
}

export interface JisoLoader {
  events: readonly string[];
}

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;

  for (const eventName of events) {
    options.root.addEventListener(
      eventName,
      async (event) => {
        await dispatchDelegatedEvent(event, options.importModule);
      },
      { capture: true },
    );
  }

  return { events };
}

export async function dispatchDelegatedEvent(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
): Promise<void> {
  const element = event.target?.closest?.(`[on\\:${event.type}]`);
  if (!element) return;

  const ref = element.getAttribute(`on:${event.type}`);
  if (!ref) return;

  const { exportName, url } = parseHandlerReference(ref);
  const mod = await importModule(url);
  const fn = mod[exportName];

  if (typeof fn !== 'function') {
    throw new Error(`Handler export not found: ${ref}`);
  }

  await (fn as ClientHandler)(event as Event, {
    params: readElementParams(element),
    state: {},
  });
}

export function parseHandlerReference(ref: string): { exportName: string; url: string } {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === ref.length - 1) {
    throw new Error(`Invalid handler reference: ${ref}`);
  }

  return {
    exportName: ref.slice(hashIndex + 1),
    url: ref.slice(0, hashIndex),
  };
}

export function readElementParams(element: EventElementLike): Record<string, string> {
  const params: Record<string, string> = {};

  for (const attribute of element.attributes ?? []) {
    if (!attribute.name.startsWith('data-p-')) continue;

    params[camelCase(attribute.name.slice('data-p-'.length))] = attribute.value;
  }

  return params;
}

function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}
