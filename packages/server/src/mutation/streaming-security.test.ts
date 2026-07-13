import { afterEach, describe, expect, it } from 'vitest';

import type { BufferedMutationWireResponse } from '../mutation-wire.js';
import { frameworkWireBody } from '../response.js';
import type { MutationReplayReservation } from '../replay.js';
import { renderStreamingMutationWireResponse, stream } from './streaming.js';

const nativeArrayJoin = Array.prototype.join;
const nativePromiseRace = Promise.race;
const nativeTextEncoderEncode = TextEncoder.prototype.encode;

afterEach(() => {
  Array.prototype.join = nativeArrayJoin;
  Promise.race = nativePromiseRace;
  TextEncoder.prototype.encode = nativeTextEncoderEncode;
});

describe('streaming mutation output security', () => {
  it('keeps live response bytes exact after a post-yield TextEncoder replacement', async () => {
    let triggers = 0;
    async function* chunks() {
      TextEncoder.prototype.encode = function (input = ''): Uint8Array {
        if (input.includes('<kovo-text')) {
          triggers += 1;
          TextEncoder.prototype.encode = nativeTextEncoderEncode;
          return Reflect.apply(nativeTextEncoderEncode, this, [
            '<kovo-fragment target="account"><img src=x onerror="globalThis.__kovoStreamXss=1"></kovo-fragment>\n',
          ]);
        }
        return Reflect.apply(nativeTextEncoderEncode, this, [input]);
      };
      yield stream.text('account', 'safe <b>text</b>');
      yield stream.done();
    }

    const response = renderStreamingMutationWireResponse(chunks(), finalResponse());
    const body = await readBody(response.body as ReadableStream<Uint8Array>);

    expect(triggers).toBe(0);
    expect(body).toContain('safe &lt;b&gt;text&lt;/b&gt;');
    expect(body).toContain('<kovo-done');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('onerror');
  });

  it('commits exactly the live bytes after one-shot replay join poisoning', async () => {
    let triggers = 0;
    let committed: BufferedMutationWireResponse | undefined;
    const reservation: MutationReplayReservation<BufferedMutationWireResponse> = {
      commit(response) {
        committed = response;
      },
    };
    async function* chunks() {
      Array.prototype.join = function (separator?: string): string {
        if (
          separator === '' &&
          this.length > 0 &&
          typeof this[0] === 'string' &&
          this[0].includes('<kovo-text')
        ) {
          triggers += 1;
          Array.prototype.join = nativeArrayJoin;
          return '<kovo-fragment target="account"><img src=x onerror="globalThis.__kovoReplayXss=1"></kovo-fragment>\n';
        }
        return Reflect.apply(nativeArrayJoin, this, [separator]);
      };
      yield stream.text('account', 'same replay truth');
      yield stream.done();
    }

    const response = renderStreamingMutationWireResponse(chunks(), finalResponse(), reservation);
    const body = await readBody(response.body as ReadableStream<Uint8Array>);

    expect(triggers).toBe(0);
    expect(committed).toBeDefined();
    expect(committed!.body).toBe(body);
    expect(committed!.body).toContain('same replay truth');
    expect(committed!.body).not.toContain('<img');
    expect(committed!.body).not.toContain('onerror');
  });

  it('does not dispatch a late Promise.race replacement for stream chunk authority', async () => {
    let raceHits = 0;
    async function* chunks() {
      Promise.race = function poisonedRace(values: Iterable<unknown>) {
        raceHits += 1;
        return Reflect.apply(nativePromiseRace, Promise, [values]);
      } as typeof Promise.race;
      yield stream.text('account', 'committed stream text');
      yield stream.done();
    }

    const response = renderStreamingMutationWireResponse(chunks(), finalResponse());
    const body = await readBody(response.body as ReadableStream<Uint8Array>);

    expect(body).toContain('committed stream text');
    expect(body).toContain('<kovo-done');
    expect(raceHits).toBe(0);
  });
});

function finalResponse(): BufferedMutationWireResponse {
  return {
    body: frameworkWireBody(''),
    headers: {},
    status: 200,
  };
}

async function readBody(streamBody: ReadableStream<Uint8Array>): Promise<string> {
  const reader = streamBody.getReader();
  const decoder = new TextDecoder();
  let body = '';
  for (;;) {
    const result = await reader.read();
    if (result.done) return body;
    body += decoder.decode(result.value, { stream: true });
  }
}
