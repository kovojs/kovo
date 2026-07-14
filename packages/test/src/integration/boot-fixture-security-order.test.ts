import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootFixture, type BootedFixture } from './boot-fixture.js';

let booted: BootedFixture | undefined;

afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

describe('fixture security bootstrap order (SPEC §6.6 rule 6)', () => {
  it('initializes exact SSR compiler/server copies before a poison-first fixture dependency', async () => {
    const timerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
    const arrayDescriptor = Object.getOwnPropertyDescriptor(Array, 'isArray');
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    booted = await bootFixture(fixtureDir);

    const response = await fetch(booted.origin);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('<h1>Bootstrap first</h1>');
    await expect(booted.db.query('select 1::int as value')).resolves.toEqual([{ value: 1 }]);
    await expect(booted.db.exec('select 1')).resolves.toBeInstanceOf(Array);
    await expect(booted.verificationDiagnostics()).resolves.toEqual([]);
    await booted.reset();
    await expect(booted.db.query('select 2::int as value')).resolves.toEqual([{ value: 2 }]);
    await expect(booted.db.query('x'.repeat(8 * 1024 * 1024))).rejects.toThrow(
      'exceeds the 8 MiB message limit',
    );
    expect(booted.origin).not.toBe('http://127.0.0.1:1');

    await booted.close();
    booted = undefined;
    expect(Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')).toEqual(timerDescriptor);
    expect(Object.getOwnPropertyDescriptor(Array, 'isArray')).toEqual(arrayDescriptor);
    vi.useFakeTimers();
    vi.useRealTimers();
  });

  it('rejects deterministically when the isolated authored graph terminates its worker', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    await expect(bootFixture(fixtureDir, { entry: '/crash.ts' })).rejects.toThrow(
      'exited before shutdown (code 7',
    );
  });
});
