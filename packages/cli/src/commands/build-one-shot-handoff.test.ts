import { describe, expect, it } from 'vitest';

import {
  encodeKovoBuildOneShotHandoff,
  inspectKovoBuildOneShotHandoff,
  kovoBuildOneShotDigest,
  KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
  readKovoBuildOneShotHandoff,
  type KovoBuildOneShotIdentity,
} from './build-one-shot-handoff.js';

function identity(): KovoBuildOneShotIdentity {
  return {
    appModulePath: 'src/app.tsx',
    compilerProvenanceDigest: kovoBuildOneShotDigest({ compiler: '0.3.0' }),
    configSourceDigest: kovoBuildOneShotDigest({ config: 'node' }),
    invocationRoot: process.cwd(),
    optionsDigest: kovoBuildOneShotDigest({ cache: true, preset: 'node' }),
    sourceSetDigest: kovoBuildOneShotDigest([{ fileName: 'src/app.tsx', source: 'safe' }]),
  };
}

function wire() {
  const expectedIdentity = identity();
  return {
    bytes: encodeKovoBuildOneShotHandoff({
      analysis: { checkGraph: { routes: [] } },
      identity: expectedIdentity,
      schema: 'kovo-build-one-shot-analysis/v1',
    }),
    expectedIdentity,
  };
}

describe('one-shot build private handoff', () => {
  it('round-trips one exact, authenticated, deeply frozen payload', () => {
    const handoff = wire();
    expect(inspectKovoBuildOneShotHandoff(handoff.bytes)).toEqual({
      identity: handoff.expectedIdentity,
    });
    const payload = readKovoBuildOneShotHandoff(handoff.bytes, handoff.expectedIdentity);
    expect(payload).toEqual({
      analysis: { checkGraph: { routes: [] } },
      identity: handoff.expectedIdentity,
      schema: 'kovo-build-one-shot-analysis/v1',
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.analysis)).toBe(true);
  });

  it.each([
    ['app', { appModulePath: 'src/other.tsx' }],
    ['config', { configSourceDigest: kovoBuildOneShotDigest({ config: 'cloudflare' }) }],
    ['compiler', { compilerProvenanceDigest: kovoBuildOneShotDigest({ compiler: 'forged' }) }],
    ['source set', { sourceSetDigest: kovoBuildOneShotDigest([{ source: 'changed' }]) }],
    ['options', { optionsDigest: kovoBuildOneShotDigest({ cache: false }) }],
  ])('rejects a stale or wrong %s identity', (_label, changed) => {
    const handoff = wire();
    expect(() =>
      readKovoBuildOneShotHandoff(handoff.bytes, {
        ...handoff.expectedIdentity,
        ...changed,
      }),
    ).toThrow(/stale or belongs to another invocation/u);
  });

  it('rejects truncated, extended, malformed, and tampered wire envelopes', () => {
    const handoff = wire();
    expect(() =>
      readKovoBuildOneShotHandoff(handoff.bytes.subarray(0, 12), handoff.expectedIdentity),
    ).toThrow(/prelude/u);
    expect(() =>
      readKovoBuildOneShotHandoff(
        Buffer.concat([handoff.bytes, Buffer.from('extra')]),
        handoff.expectedIdentity,
      ),
    ).toThrow(/payload length/u);

    const malformed = Buffer.from(handoff.bytes);
    malformed.fill(0x7a, 0, 4);
    expect(() => inspectKovoBuildOneShotHandoff(malformed)).toThrow(/prelude/u);

    const tampered = Buffer.from(handoff.bytes);
    tampered[tampered.length - 2] ^= 1;
    expect(() => readKovoBuildOneShotHandoff(tampered, handoff.expectedIdentity)).toThrow(
      /unauthenticated/u,
    );
  });

  it('rejects incomplete payloads and over-limit input before parsing', () => {
    const expectedIdentity = identity();
    const incomplete = encodeKovoBuildOneShotHandoff({
      identity: expectedIdentity,
      schema: 'kovo-build-one-shot-analysis/v1',
    } as never);
    expect(() => readKovoBuildOneShotHandoff(incomplete, expectedIdentity)).toThrow(/incomplete/u);

    expect(() =>
      inspectKovoBuildOneShotHandoff(new Uint8Array(KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES + 1)),
    ).toThrow(/byte limit/u);
  });

  it('rejects values whose private, accessor, symbol, or prototype state JSON would lose', () => {
    const expectedIdentity = identity();
    const accessor = {};
    Object.defineProperty(accessor, 'hidden', { enumerable: true, get: () => 'lost' });
    expect(() =>
      encodeKovoBuildOneShotHandoff({
        analysis: accessor,
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      }),
    ).toThrow(/hidden or accessor state/u);

    expect(() =>
      encodeKovoBuildOneShotHandoff({
        analysis: { [Symbol('private')]: true },
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      }),
    ).toThrow(/private symbol state/u);

    expect(() =>
      encodeKovoBuildOneShotHandoff({
        analysis: new Date(),
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      }),
    ).toThrow(/private prototype state/u);
  });

  it('uses only boot-captured wire controls after authored prototype mutation', () => {
    const hashProbe = createHash('sha256');
    const hashPrototype = Object.getPrototypeOf(hashProbe) as {
      digest: typeof hashProbe.digest;
      update: typeof hashProbe.update;
    };
    const originals = {
      arrayEvery: Array.prototype.every,
      arrayMap: Array.prototype.map,
      arrayPush: Array.prototype.push,
      arraySome: Array.prototype.some,
      arraySort: Array.prototype.sort,
      bufferAllocUnsafe: Buffer.allocUnsafe,
      bufferConcat: Buffer.concat,
      bufferFrom: Buffer.from,
      bufferSubarray: Buffer.prototype.subarray,
      bufferToString: Buffer.prototype.toString,
      hashDigest: hashPrototype.digest,
      hashUpdate: hashPrototype.update,
      mathFloor: Math.floor,
      regexpTest: RegExp.prototype.test,
      stringCharCodeAt: String.prototype.charCodeAt,
      stringPadStart: String.prototype.padStart,
      stringToString: String.prototype.toString,
    };
    const poisoned = () => {
      throw new Error('authored prototype mutation reached private handoff');
    };
    let result: ReturnType<typeof readKovoBuildOneShotHandoff> | undefined;
    try {
      Array.prototype.every = poisoned as never;
      Array.prototype.map = poisoned as never;
      Array.prototype.push = poisoned as never;
      Array.prototype.some = poisoned as never;
      Array.prototype.sort = poisoned as never;
      Buffer.allocUnsafe = poisoned as never;
      Buffer.concat = poisoned as never;
      Buffer.from = poisoned as never;
      Buffer.prototype.subarray = poisoned as never;
      Buffer.prototype.toString = poisoned as never;
      hashPrototype.digest = poisoned as never;
      hashPrototype.update = poisoned as never;
      Math.floor = poisoned;
      RegExp.prototype.test = poisoned;
      String.prototype.charCodeAt = poisoned as never;
      String.prototype.padStart = poisoned;
      String.prototype.toString = poisoned;
      const handoff = wire();
      result = readKovoBuildOneShotHandoff(handoff.bytes, handoff.expectedIdentity);
    } finally {
      Array.prototype.every = originals.arrayEvery;
      Array.prototype.map = originals.arrayMap;
      Array.prototype.push = originals.arrayPush;
      Array.prototype.some = originals.arraySome;
      Array.prototype.sort = originals.arraySort;
      Buffer.allocUnsafe = originals.bufferAllocUnsafe;
      Buffer.concat = originals.bufferConcat;
      Buffer.from = originals.bufferFrom;
      Buffer.prototype.subarray = originals.bufferSubarray;
      Buffer.prototype.toString = originals.bufferToString;
      hashPrototype.digest = originals.hashDigest;
      hashPrototype.update = originals.hashUpdate;
      Math.floor = originals.mathFloor;
      RegExp.prototype.test = originals.regexpTest;
      String.prototype.charCodeAt = originals.stringCharCodeAt;
      String.prototype.padStart = originals.stringPadStart;
      String.prototype.toString = originals.stringToString;
    }
    expect(result?.schema).toBe('kovo-build-one-shot-analysis/v1');
  });
});
import { createHash } from 'node:crypto';
