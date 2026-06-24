import { describe, expect, it, vi } from 'vitest';

import {
  EgressBlockedError,
  assertEgressAllowed,
  createEgressFetch,
  normalizeAllowInternal,
} from './egress.js';

describe('server egress private-network deny floor', () => {
  it('allows public destinations without declarations', async () => {
    await expect(
      assertEgressAllowed('https://api.example.test/v1', [], async () => '93.184.216.34'),
    ).resolves.toMatchObject({
      destination: 'api.example.test:443',
      ip: '93.184.216.34',
      private: false,
    });
  });

  it('blocks loopback, private, link-local, and metadata destinations by default', async () => {
    await expect(assertEgressAllowed('http://127.0.0.1:8080', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(assertEgressAllowed('http://10.0.5.2:6379', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(assertEgressAllowed('http://169.254.170.2/', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(
      assertEgressAllowed('http://metadata.google.internal/', [], async () => '169.254.169.254'),
    ).rejects.toMatchObject({
      destination: 'metadata.google.internal:80',
      status: 502,
    });
  });

  it('allows only exact configured internal host:port pairs', async () => {
    const allowInternal = normalizeAllowInternal(['LOCALHOST:11434', '10.0.5.2:6379']);

    await expect(assertEgressAllowed('http://localhost:11434/api', allowInternal)).resolves.toEqual(
      expect.objectContaining({
        destination: 'localhost:11434',
        private: true,
      }),
    );
    await expect(assertEgressAllowed('http://localhost:8080/api', allowInternal)).rejects.toThrow(
      /localhost:8080/,
    );
  });

  it('normalizes numeric and mapped private IP spellings before deciding', async () => {
    await expect(assertEgressAllowed('http://2130706433/', [])).rejects.toMatchObject({
      ip: '127.0.0.1',
    });
    await expect(assertEgressAllowed('http://0x7f000001/', [])).rejects.toMatchObject({
      ip: '127.0.0.1',
    });
    await expect(assertEgressAllowed('http://[64:ff9b::a9fe:a9fe]/', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('rechecks each redirect hop before following it', async () => {
    const baseFetch = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        headers: { Location: 'http://127.0.0.1/admin' },
        status: 302,
      });
    });
    const guardedFetch = createEgressFetch(
      { allowInternal: [] },
      {
        fetch: baseFetch,
        resolver: async (host) => (host === 'api.example.test' ? '93.184.216.34' : '127.0.0.1'),
      },
    );

    await expect(guardedFetch('https://api.example.test/start')).rejects.toMatchObject({
      destination: '127.0.0.1:80',
      status: 502,
    });
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
