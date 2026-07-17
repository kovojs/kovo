import { describe, expect, it } from 'vitest';

import {
  boundaryCrossingSinkInventory,
  dangerousSinkTokens,
  frameworkSourceSinkInventory,
  sourceSinkRedCorpus,
  sourceSinkRuntimeEvidence,
} from './source-sink-registry.js';

// @kovo-security-classifier-corpus sink-registry
describe('boundary crossing sink inventory', () => {
  it('does not expose mutable proof registries through the internal package subpath', () => {
    const sourceSink = frameworkSourceSinkInventory();
    const boundary = boundaryCrossingSinkInventory();
    const tokens = dangerousSinkTokens();
    const corpus = sourceSinkRedCorpus();
    const evidence = sourceSinkRuntimeEvidence();

    expect(Object.isFrozen(sourceSink)).toBe(true);
    expect(Object.isFrozen(sourceSink[0])).toBe(true);
    expect(Object.isFrozen(sourceSink[0]!.testEvidence)).toBe(true);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary[0])).toBe(true);
    expect(Object.isFrozen(tokens)).toBe(true);
    expect(Object.isFrozen(tokens[0])).toBe(true);
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus[0]!.payloads)).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.failClosedCases)).toBe(true);
    expect(Object.isFrozen(evidence.failClosedCases[0]!.testEvidence)).toBe(true);

    expect(Reflect.set(sourceSink, 0, sourceSink[1])).toBe(false);
    expect(Reflect.set(sourceSink[0]!, 'sink', 'attacker-controlled')).toBe(false);
    expect(Reflect.set(tokens[0]!, 'token', 'attacker-controlled')).toBe(false);
    expect(Reflect.set(corpus[0]!.payloads, 0, 'attacker-controlled')).toBe(false);
    expect(Reflect.deleteProperty(evidence, 'runtimeChokepoints')).toBe(false);
  });

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

  it('keeps browser-state cache poisoning in the C13 header/cookie superset corpus', () => {
    const headerInventory = frameworkSourceSinkInventory().find(
      (entry) => entry.sink === 'http.header.cookie',
    );
    const headerCorpus = sourceSinkRedCorpus().find(
      (entry) => entry.family === 'http.header.cookie',
    );
    const boundary = boundaryCrossingSinkInventory().find(
      (entry) => entry.sink === 'http response headers',
    );

    expect(headerInventory?.runtimeGuard).toContain('browser-state-private-no-store-floor');
    expect(headerInventory?.schema).toContain('Set-Cookie|Clear-Site-Data');
    expect(headerInventory?.testEvidence).toContain('packages/server/src/response-posture.test.ts');
    expect(headerInventory?.testEvidence).toContain('packages/server/src/app-dispatch.test.ts');
    expect(headerInventory?.testEvidence).toContain('packages/server/src/node.test.ts');
    expect(headerInventory?.testEvidence).toContain('packages/server/src/build.test.ts');
    expect(headerInventory?.testEvidence).toContain(
      'packages/server/src/static-export-headers.test.ts',
    );
    expect(headerInventory?.testEvidence).toContain(
      'packages/server/src/static-export-response.test.ts',
    );
    expect(headerInventory?.runtimeGuard).toContain('static-export-browser-state-rejection');
    expect(headerInventory?.runtimeGuard).toContain('adapter-browser-state-private-no-store-floor');
    expect(headerCorpus?.payloads).toContain(
      'public cache policy with Set-Cookie or Clear-Site-Data',
    );
    expect(boundary?.mechanismDetail).toContain('browser-state private/no-store floor');
    expect(boundary?.mechanismDetail).toContain('static export rejects');
  });

  it('keeps browser-effective meta refresh pairing in the C13 HTML sink corpus', () => {
    const htmlInventory = frameworkSourceSinkInventory().find(
      (entry) => entry.sink === 'html.dom.output',
    );
    const htmlCorpus = sourceSinkRedCorpus().find((entry) => entry.family === 'html.dom.output');

    expect(htmlInventory?.runtimeGuard).toContain('server-meta-refresh-first-attribute-pair');
    expect(htmlInventory?.schema).toContain('meta-refresh-first-http-equiv-pair');
    expect(htmlInventory?.testEvidence).toContain('packages/server/src/jsx-runtime.test.ts');
    expect(htmlInventory?.testEvidence).toContain(
      'tests/integration/specs/meta-refresh-sink.spec.ts',
    );
    expect(htmlCorpus?.payloads).toContain('ASCII-case duplicate meta refresh navigation');
    expect(htmlCorpus?.negativeTestEvidence).toContain('packages/server/src/jsx-runtime.test.ts');
    expect(htmlCorpus?.negativeTestEvidence).toContain(
      'tests/integration/specs/meta-refresh-sink.spec.ts',
    );
  });
});
