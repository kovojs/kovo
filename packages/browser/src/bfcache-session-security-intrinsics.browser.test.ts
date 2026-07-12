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

it('keeps the generated inline session reload pinned after late PageTransitionEvent persisted poisoning', async () => {
  // SPEC §5.2/§8: exercise the shipped generated artifact, not hand-authored
  // lowered IR, and prove its boot-local getter is the one that drives reload.
  const frame = document.createElement('iframe');
  frame.srcdoc = [
    '<!doctype html><html><head>',
    '<meta name="kovo-session" content="principal-fp">',
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
