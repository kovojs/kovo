import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  boundaryCrossingSinkInventory,
  dangerousSinkTokens,
  frameworkSourceSinkInventory,
  sourceSinkRedCorpus,
  sourceSinkRuntimeEvidence,
} from './source-sink-registry.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

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
      'authorization principal/data access',
      'dynamic module/process execution',
    ]);

    for (const entry of inventory) {
      expect(entry.censusFamilies.length, entry.sink).toBeGreaterThan(0);
      expect(entry.mechanismDetail).not.toBe('');
      expect(entry.owner).not.toBe('');
      expect(entry.proofGate).toMatch(/^pnpm run [a-z0-9:-]+$/u);
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
        ['authorization principal/data access', 'own'],
        ['dynamic module/process execution', 'own'],
      ]),
    );
  });

  it('mechanically covers the complete source/sink census with no unknown family', () => {
    const sinkFamilies = [
      ...new Set(frameworkSourceSinkInventory().map((entry) => entry.sink)),
    ].sort();
    const inventory = boundaryCrossingSinkInventory();
    const mappedFamilies = [
      ...new Set(inventory.flatMap((entry) => [...entry.censusFamilies])),
    ].sort();

    expect(mappedFamilies).toEqual(sinkFamilies);
    expect(inventory.find((entry) => entry.sink === 'db driver statement')?.censusFamilies).toEqual(
      ['sql.executable'],
    );
    expect(inventory.find((entry) => entry.sink === 'Set-Cookie')?.censusFamilies).toEqual([
      'http.header.cookie',
    ]);
    expect(inventory.find((entry) => entry.sink === 'webhook payload')?.censusFamilies).toEqual([
      'ingress.endpoint.webhook',
    ]);
    expect(inventory.find((entry) => entry.sink === 'HTML/render output')?.censusFamilies).toEqual([
      'html.dom.output',
      'document.shell.output',
      'css.style.output',
    ]);
    expect(
      inventory.find((entry) => entry.sink === 'outbound egress request')?.censusFamilies,
    ).toEqual(['network.egress']);
  });

  it('keeps every owner, proof gate, and hostile-value citation live', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const seenSinks = new Set<string>();

    for (const entry of boundaryCrossingSinkInventory()) {
      expect(seenSinks.has(entry.sink), entry.sink).toBe(false);
      seenSinks.add(entry.sink);
      const scriptName = entry.proofGate.slice('pnpm run '.length);
      expect(packageJson.scripts?.[scriptName], `${entry.sink}: ${entry.proofGate}`).toBeTruthy();
      for (const evidence of [...entry.proofEvidence, ...entry.hostileValueEvidence]) {
        expect(existsSync(`${repositoryRoot}${evidence}`), `${entry.sink}: ${evidence}`).toBe(true);
      }
    }
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
