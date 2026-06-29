import { describe, expect, it } from 'vitest';

import { checkExampleHealth } from './example-health.mjs';

const examples = [
  {
    embed: 'service',
    name: 'commerce',
    serviceUrl: 'https://commerce.example.test',
  },
  {
    embed: 'service',
    name: 'stackoverflow',
    serviceUrl: 'https://stackoverflow.example.test',
  },
];

function outputSink() {
  return { write() {} };
}

function bodyForUrl(url) {
  const key = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  return typeof key === 'string' ? key : '';
}

describe('example-health', () => {
  it('passes only when live routes expose route-specific behavior signals', async () => {
    const bodies = new Map([
      ['https://commerce.example.test/', 'Aero Wireless Keyboard\nSign in to add items'],
      ['https://commerce.example.test/cart', 'Aero Wireless Keyboard\nCart'],
      ['https://stackoverflow.example.test/', 'All Questions\nAsk Question'],
      ['https://stackoverflow.example.test/questions/q1', 'Accepted answer\nDrizzle mutation'],
    ]);
    const result = await checkExampleHealth({
      examples,
      fetchImpl: async (url) => new Response(bodies.get(bodyForUrl(url)) ?? '', { status: 200 }),
      output: outputSink(),
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when a live route is non-empty but missing its behavior signal', async () => {
    const bodies = new Map([
      ['https://commerce.example.test/', 'Aero Wireless Keyboard\nSign in to add items'],
      ['https://commerce.example.test/cart', 'Aero Wireless Keyboard\nCart'],
      ['https://stackoverflow.example.test/', 'All Questions\nAsk Question'],
      ['https://stackoverflow.example.test/questions/q1', 'Question page without answer body'],
    ]);
    const result = await checkExampleHealth({
      examples,
      fetchImpl: async (url) => new Response(bodies.get(bodyForUrl(url)) ?? '', { status: 200 }),
      output: outputSink(),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'stackoverflow/questions/q1: missing Accepted answer, Drizzle mutation',
    ]);
  });
});
