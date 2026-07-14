import { afterEach, expect, it, vi } from 'vitest';

import { inlineKovoLoaderInstallerSource } from './inline-loader.js';
import { installBfcacheSessionReload } from './query-visible-return.js';

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

it('keeps the modular session reload pinned after late PageTransitionEvent persisted poisoning', () => {
  // C136 / SPEC §8: a same-realm app must not suppress the second bfcache
  // defense by replacing the WebIDL getter after framework boot.
  const descriptor = Object.getOwnPropertyDescriptor(PageTransitionEvent.prototype, 'persisted');
  if (!descriptor?.get) throw new Error('PageTransitionEvent.persisted getter unavailable');
  const target = new EventTarget();
  const reload = vi.fn();
  const installed = installBfcacheSessionReload({
    document: {
      querySelector: () => ({ getAttribute: () => 'principal-fp' }),
    },
    pageShowTarget: target,
    reload,
  });
  const restored = new PageTransitionEvent('pageshow', { persisted: true });
  expect(Reflect.apply(descriptor.get, restored, [])).toBe(true);

  let poisonCalls = 0;
  Object.defineProperty(PageTransitionEvent.prototype, 'persisted', {
    ...descriptor,
    get: () => {
      poisonCalls += 1;
      return false;
    },
  });
  try {
    target.dispatchEvent(restored);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(poisonCalls).toBe(0);
  } finally {
    Object.defineProperty(PageTransitionEvent.prototype, 'persisted', descriptor);
  }

  target.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  expect(reload).toHaveBeenCalledTimes(1);
  installed.dispose();
});

it('keeps modular bfcache enrollment pinned after late real-document query poisoning', () => {
  // C183 / SPEC §6.6/§8: the session posture is a real-document security read. A late authored
  // prototype replacement must not hide the server-stamped principal meta and suppress reload.
  const queryDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'querySelector');
  const dispatchDescriptor = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    'dispatchEvent',
  );
  if (!queryDescriptor?.value || !dispatchDescriptor?.value) {
    throw new Error('Document/EventTarget controls unavailable');
  }
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'kovo-session-dependent');
  meta.setAttribute('content', 'principal-fp');
  document.head.append(meta);
  const target = new EventTarget();
  const reload = vi.fn();
  let queryPoisonCalls = 0;
  let installed: ReturnType<typeof installBfcacheSessionReload> | undefined;

  Object.defineProperty(Document.prototype, 'querySelector', {
    ...queryDescriptor,
    value(this: Document, selector: string) {
      if (this === document && selector === 'meta[name="kovo-session-dependent"]') {
        queryPoisonCalls += 1;
        return null;
      }
      return Reflect.apply(queryDescriptor.value, this, [selector]);
    },
  });
  try {
    installed = installBfcacheSessionReload({ pageShowTarget: target, reload });
    expect(queryPoisonCalls).toBe(0);
  } finally {
    Object.defineProperty(Document.prototype, 'querySelector', queryDescriptor);
  }

  try {
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: false }),
    ]);
    expect(reload).not.toHaveBeenCalled();
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: true }),
    ]);
    expect(reload).toHaveBeenCalledTimes(1);

    installed?.dispose();
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: true }),
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    installed?.dispose();
    meta.remove();
  }
});

it('keeps modular bfcache enrollment and disposal pinned after late EventTarget poisoning', () => {
  // C183 / SPEC §6.6/§8: real EventTarget add/remove controls are captured and semantically
  // witnessed at boot. Late no-op replacements cannot suppress enrollment or leave it installed.
  const addDescriptor = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener');
  const removeDescriptor = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    'removeEventListener',
  );
  const dispatchDescriptor = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    'dispatchEvent',
  );
  if (!addDescriptor?.value || !removeDescriptor?.value || !dispatchDescriptor?.value) {
    throw new Error('EventTarget controls unavailable');
  }
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'kovo-session-dependent');
  meta.setAttribute('content', 'principal-fp');
  document.head.append(meta);
  const target = new EventTarget();
  const reload = vi.fn();
  let addPoisonCalls = 0;
  let removePoisonCalls = 0;
  let installed: ReturnType<typeof installBfcacheSessionReload> | undefined;

  Object.defineProperty(EventTarget.prototype, 'addEventListener', {
    ...addDescriptor,
    value(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
      if (this === target && type === 'pageshow') {
        addPoisonCalls += 1;
        return;
      }
      return Reflect.apply(addDescriptor.value, this, [type, listener]);
    },
  });
  try {
    installed = installBfcacheSessionReload({ pageShowTarget: target, reload });
    expect(addPoisonCalls).toBe(0);
  } finally {
    Object.defineProperty(EventTarget.prototype, 'addEventListener', addDescriptor);
  }

  try {
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: false }),
    ]);
    expect(reload).not.toHaveBeenCalled();
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: true }),
    ]);
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(EventTarget.prototype, 'removeEventListener', {
      ...removeDescriptor,
      value(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        if (this === target && type === 'pageshow') {
          removePoisonCalls += 1;
          return;
        }
        return Reflect.apply(removeDescriptor.value, this, [type, listener]);
      },
    });
    try {
      installed?.dispose();
      expect(removePoisonCalls).toBe(0);
    } finally {
      Object.defineProperty(EventTarget.prototype, 'removeEventListener', removeDescriptor);
    }
    Reflect.apply(dispatchDescriptor.value, target, [
      new PageTransitionEvent('pageshow', { persisted: true }),
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(EventTarget.prototype, 'addEventListener', addDescriptor);
    Object.defineProperty(EventTarget.prototype, 'removeEventListener', removeDescriptor);
    installed?.dispose();
    meta.remove();
  }
});

it('keeps the generated inline session reload pinned after late PageTransitionEvent persisted poisoning', async () => {
  // SPEC §5.2/§8: exercise the shipped generated artifact, not hand-authored
  // lowered IR, and prove its boot-local getter is the one that drives reload.
  const frame = document.createElement('iframe');
  frame.srcdoc = [
    '<!doctype html><html><head>',
    '<meta name="kovo-session-dependent" content="true">',
    '</head><body><main id="booted">SESSION TRUTH</main></body></html>',
  ].join('');
  frames.push(frame);
  let loads = 0;
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => {
      loads += 1;
      resolve();
    });
  });
  document.body.append(frame);
  await loaded;

  const frameWindow = frame.contentWindow as Window & typeof globalThis;
  const frameDocument = frameWindow.document;
  const descriptor = Object.getOwnPropertyDescriptor(
    frameWindow.PageTransitionEvent.prototype,
    'persisted',
  );
  if (!descriptor?.get) throw new Error('PageTransitionEvent.persisted getter unavailable');
  (frameWindow as unknown as Record<string, unknown>).__kovoPersistedPoisonImport =
    async () => ({});
  const script = frameDocument.createElement('script');
  script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoPersistedPoisonImport);`;
  frameDocument.head.append(script);
  const restored = new frameWindow.PageTransitionEvent('pageshow', { persisted: true });
  expect(Reflect.apply(descriptor.get, restored, [])).toBe(true);

  let poisonCalls = 0;
  const reloaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  Object.defineProperty(frameWindow.PageTransitionEvent.prototype, 'persisted', {
    ...descriptor,
    get: () => {
      poisonCalls += 1;
      return false;
    },
  });
  try {
    frameWindow.dispatchEvent(restored);
    await reloaded;
    expect(loads).toBe(2);
    expect(poisonCalls).toBe(0);
  } finally {
    Object.defineProperty(frameWindow.PageTransitionEvent.prototype, 'persisted', descriptor);
  }
});
