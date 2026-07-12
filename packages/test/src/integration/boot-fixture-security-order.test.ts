import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { bootFixture, type BootedFixture } from './boot-fixture.js';

let booted: BootedFixture | undefined;

afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

describe('fixture security bootstrap order (SPEC §6.6 rule 6)', () => {
  it('initializes exact SSR compiler/server copies before a poison-first fixture dependency', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    booted = await bootFixture(fixtureDir);

    const response = await fetch(booted.origin);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('<h1>Bootstrap first</h1>');
  });
});
