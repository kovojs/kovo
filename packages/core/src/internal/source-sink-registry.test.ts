import { describe, expect, it } from 'vitest';

import {
  boundaryCrossingSinkInventory,
  frameworkSourceSinkInventory,
} from './source-sink-registry.js';

// @kovo-security-classifier-corpus sink-registry
describe('boundary crossing sink inventory', () => {
  it('covers the DEC-E required sink set with mechanism and proof metadata', () => {
    const inventory = boundaryCrossingSinkInventory();
    expect(inventory.map((entry) => entry.sink)).toEqual([
      'db driver statement',
      'http response body',
      'http response headers',
      'redirect URL',
      'Set-Cookie',
      'blob/file write',
      'durable-task payload',
      'webhook payload',
      'HTML/render output',
      'log/error output',
      'outbound egress request',
    ]);

    for (const entry of inventory) {
      expect(entry.mechanismDetail).not.toBe('');
      expect(entry.soleDoor).not.toBe('');
      expect(entry.hostileValueEvidence.length, entry.sink).toBeGreaterThan(0);
      expect(entry.proofEvidence.length, entry.sink).toBeGreaterThan(0);
      expect(entry.specAnchor, entry.sink).not.toBe('');
    }
  });

  it('keeps each required sink tied to reconstruct, box, or own mechanics', () => {
    const mechanisms = new Map(
      boundaryCrossingSinkInventory().map((entry) => [entry.sink, entry.mechanism]),
    );

    expect(mechanisms).toEqual(
      new Map([
        ['db driver statement', 'reconstruct'],
        ['http response body', 'reconstruct'],
        ['http response headers', 'own'],
        ['redirect URL', 'reconstruct'],
        ['Set-Cookie', 'own'],
        ['blob/file write', 'own'],
        ['durable-task payload', 'own'],
        ['webhook payload', 'own'],
        ['HTML/render output', 'reconstruct'],
        ['log/error output', 'box'],
        ['outbound egress request', 'own'],
      ]),
    );
  });

  it('anchors the sink-proof inventory in the broader source/sink families', () => {
    const sinkFamilies = new Set(frameworkSourceSinkInventory().map((entry) => entry.sink));
    const inventory = boundaryCrossingSinkInventory();

    expect(sinkFamilies.has('sql.executable')).toBe(true);
    expect(sinkFamilies.has('http.header.cookie')).toBe(true);
    expect(sinkFamilies.has('file.storage.static-export')).toBe(true);
    expect(sinkFamilies.has('html.dom.output')).toBe(true);
    expect(sinkFamilies.has('ingress.endpoint.webhook')).toBe(true);
    expect(inventory.find((entry) => entry.sink === 'db driver statement')?.inventoryFamily).toBe(
      'sql.executable',
    );
    expect(inventory.find((entry) => entry.sink === 'Set-Cookie')?.inventoryFamily).toBe(
      'http.header.cookie',
    );
    expect(inventory.find((entry) => entry.sink === 'webhook payload')?.inventoryFamily).toBe(
      'ingress.endpoint.webhook',
    );
  });
});
