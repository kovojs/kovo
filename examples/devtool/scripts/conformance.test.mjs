import { describe, expect, it } from 'vitest';

import { kovoExplain } from '@kovojs/cli';

import { runConformance } from './conformance.mjs';

describe('devtool human/agent/CLI parity', () => {
  it('keeps UI edges, MCP cards, and CLI text aligned over every committed app fixture', () => {
    expect(runConformance(kovoExplain)).toEqual({ apps: 3, failures: [] });
  });
});
