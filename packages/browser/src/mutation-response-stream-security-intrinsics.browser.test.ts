import { afterEach, expect, it, vi } from 'vitest';

import { applyStreamingMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { inlineKovoLoaderInstallerSource } from './inline-loader.js';
import { DomMorphRoot } from './morph.js';
import { createQueryStore } from './query-store.js';

const nativeGetReader = ReadableStream.prototype.getReader;
const nativeStringSlice = String.prototype.slice;
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  ReadableStream.prototype.getReader = nativeGetReader;
  String.prototype.slice = nativeStringSlice;
  document.body.replaceChildren();
  for (const frame of frames.splice(0)) frame.remove();
});

function mutationWire(value: string): string {
  return [
    '<kovo-fragment target="messages">',
    `<section kovo-fragment-target="messages">${value}</section>`,
    '</kovo-fragment>',
    '<kovo-done reason="complete"></kovo-done>',
  ].join('');
}

function substituteReader(
  Stream: typeof ReadableStream,
  Encoder: typeof TextEncoder,
  source: ReadableStream<Uint8Array>,
  value: string,
): { calls(): number; restore(): void } {
  const original = Stream.prototype.getReader;
  let calls = 0;
  Stream.prototype.getReader = function poisonedGetReader(...args: unknown[]) {
    if (this !== source) return Reflect.apply(original, this, args);
    calls += 1;
    Stream.prototype.getReader = original;
    let emitted = false;
    return {
      async cancel() {},
      async read() {
        if (emitted) return { done: true, value: undefined };
        emitted = true;
        return { done: false, value: new Encoder().encode(value) };
      },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  } as typeof ReadableStream.prototype.getReader;
  return {
    calls: () => calls,
    restore() {
      Stream.prototype.getReader = original;
    },
  };
}

it('pins the modular streaming mutation reader before a late getReader substitution', async () => {
  // C107 / SPEC §6.6 rule 5 and §9.1: the exact server byte stream is acquired,
  // read, snapshotted, and released through the boot-witnessed reader plan.
  document.body.innerHTML =
    '<section kovo-fragment-target="messages">INITIAL SERVER TRUTH</section>';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(mutationWire('SAFE SERVER STREAM')));
      controller.close();
    },
  });
  const poison = substituteReader(
    ReadableStream,
    TextEncoder,
    body,
    mutationWire('ATTACKER SUBSTITUTED STREAM'),
  );

  try {
    await applyStreamingMutationResponseBodyToRuntime({
      body,
      root: new DomMorphRoot(document),
      store: createQueryStore(),
    });
  } finally {
    poison.restore();
  }

  expect(poison.calls()).toBe(0);
  expect(document.querySelector('[kovo-fragment-target="messages"]')?.textContent).toBe(
    'SAFE SERVER STREAM',
  );
});

it('keeps modular streamed query bytes authoritative after late String.slice poisoning', async () => {
  const store = createQueryStore();
  const attackerChunk = '<kovo-query name="account">{"role":"attacker"}</kovo-query>';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode('<kovo-query name="account">{"role":"server"}</kovo-query>'),
      );
      controller.enqueue(encoder.encode('<kovo-done reason="complete"></kovo-done>'));
      controller.close();
    },
  });
  let substituted = false;
  String.prototype.slice = function poisonedSlice(start?: number, end?: number): string {
    if (!substituted && typeof start === 'number' && start > 0 && end === undefined) {
      substituted = true;
      return attackerChunk;
    }
    return Reflect.apply(nativeStringSlice, this, [start, end]);
  };

  try {
    await applyStreamingMutationResponseBodyToRuntime({ body, store });
  } finally {
    String.prototype.slice = nativeStringSlice;
  }

  expect(substituted).toBe(false);
  expect(store.get('account')).toEqual({ role: 'server' });
});

it('pins the generated inline streaming mutation reader before a late getReader substitution', async () => {
  // SPEC §5.2/§6.6: the generated artifact consumes the same witnessed reader
  // controls; this exercises the shipped source rather than hand-authored IR.
  const frame = document.createElement('iframe');
  frame.srcdoc = [
    '<!doctype html><html><head></head><body>',
    '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
    '<section kovo-fragment-target="messages">INITIAL SERVER TRUTH</section>',
    '</body></html>',
  ].join('');
  frames.push(frame);
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  document.body.append(frame);
  await loaded;
  const frameWindow = frame.contentWindow as Window & typeof globalThis;
  const frameDocument = frameWindow.document;
  const safeBody = new frameWindow.ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new frameWindow.TextEncoder().encode(mutationWire('SAFE SERVER STREAM')));
      controller.close();
    },
  });
  (frameWindow as unknown as Record<string, unknown>).fetch = vi.fn(
    async () =>
      new frameWindow.Response(safeBody, {
        headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; stream=1' },
        status: 200,
      }),
  );
  (frameWindow as unknown as Record<string, unknown>).__kovoStreamSecurityImport = async () => ({});
  const script = frameDocument.createElement('script');
  script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoStreamSecurityImport);`;
  frameDocument.head.append(script);
  const poison = substituteReader(
    frameWindow.ReadableStream,
    frameWindow.TextEncoder,
    safeBody,
    mutationWire('ATTACKER SUBSTITUTED STREAM'),
  );

  try {
    frameDocument
      .querySelector('form')
      ?.dispatchEvent(new frameWindow.SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(frameDocument.querySelector('[kovo-fragment-target="messages"]')?.textContent).toBe(
        'SAFE SERVER STREAM',
      ),
    );
  } finally {
    poison.restore();
  }

  expect(poison.calls()).toBe(0);
});
