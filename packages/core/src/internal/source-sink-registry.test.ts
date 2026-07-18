import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  boundaryCrossingSinkInventory,
  dangerousSinkTokens,
  frameworkSourceSinkInventory,
  sourceSinkRedCorpus,
  sourceSinkRuntimeEvidence,
  type BoundaryCrossingSinkInventoryEntry,
  type SourceSinkInventoryEntry,
} from './source-sink-registry.js';
import { securityOperationKinds } from './security-operation-ir.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const rootScripts = (
  JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  }
).scripts;
const requiredC9SinkNames = [
  'db driver statement',
  'http response body',
  'http response headers',
  'redirect URL',
  'Set-Cookie',
  'blob/file write',
  'durable-task payload',
  'request method/authority/scheme',
  'webhook payload',
  'HTML/render output',
  'log/error output',
  'outbound egress request',
  'authorization principal/data access',
  'Better Auth credential/non-egress',
  'dynamic module/process execution',
] as const;
const allowedBoundaryCrossingMechanisms = new Set(['reconstruct', 'box', 'own']);

function assertNonBlank(value: string, label: string): void {
  if (value.trim() === '') throw new Error(`${label} must be non-blank.`);
}

function assertC9SinkInventoryComplete(
  census: readonly SourceSinkInventoryEntry[],
  inventory: readonly BoundaryCrossingSinkInventoryEntry[],
): void {
  if (!rootScripts?.check?.includes('pnpm run check:c9-sink-inventory')) {
    throw new Error('The C9 completeness gate is not enrolled in pnpm run check.');
  }

  const censusFamilyNames = census.map((entry) => entry.sink);
  const censusFamilies = new Set(censusFamilyNames);
  if (censusFamilies.size !== censusFamilyNames.length) {
    throw new Error('The source/sink census contains duplicate family rows.');
  }
  const requiredSinks = new Set<string>(requiredC9SinkNames);
  const coveredFamilies = new Set<string>();
  const seenSinks = new Set<string>();
  const requiredOperations = new Set(securityOperationKinds);
  const seenOperations = new Set<string>();

  for (const entry of inventory) {
    assertNonBlank(entry.sink, 'C9 sink name');
    if (seenSinks.has(entry.sink)) throw new Error(`Duplicate C9 sink row: ${entry.sink}.`);
    if (!requiredSinks.has(entry.sink)) throw new Error(`Unknown C9 sink row: ${entry.sink}.`);
    seenSinks.add(entry.sink);

    if (!allowedBoundaryCrossingMechanisms.has(entry.mechanism)) {
      throw new Error(
        `${entry.sink} has an unknown boundary-crossing mechanism: ${entry.mechanism}.`,
      );
    }
    assertNonBlank(entry.mechanismDetail, `${entry.sink} mechanism detail`);
    assertNonBlank(entry.soleDoor, `${entry.sink} sole door`);
    assertNonBlank(entry.owner, `${entry.sink} owner`);
    assertNonBlank(entry.specAnchor, `${entry.sink} SPEC anchor`);
    if (!/^@kovojs\/[a-z0-9-]+\/[a-z0-9-]+$/u.test(entry.owner)) {
      throw new Error(`${entry.sink} owner is not a stable package/module owner: ${entry.owner}.`);
    }
    if (entry.censusFamilies.length === 0) {
      throw new Error(`${entry.sink} does not discharge a source/sink census family.`);
    }
    for (const family of entry.censusFamilies) {
      assertNonBlank(family, `${entry.sink} census family`);
      if (!censusFamilies.has(family)) {
        throw new Error(`${entry.sink} cites unknown source/sink census family: ${family}.`);
      }
      coveredFamilies.add(family);
    }
    for (const operation of entry.operationKinds) {
      if (!requiredOperations.has(operation)) {
        throw new Error(`${entry.sink} cites unknown finite security operation: ${operation}.`);
      }
      if (seenOperations.has(operation)) {
        throw new Error(`Duplicate C9 finite security-operation owner: ${operation}.`);
      }
      seenOperations.add(operation);
    }

    const proofGateMatch = /^pnpm run ([a-z0-9:-]+)$/u.exec(entry.proofGate);
    if (proofGateMatch === null || rootScripts?.[proofGateMatch[1]!] === undefined) {
      throw new Error(`${entry.sink} does not cite a live root proof gate: ${entry.proofGate}.`);
    }
    if (entry.proofEvidence.length === 0) {
      throw new Error(`${entry.sink} has no proof evidence.`);
    }
    if (entry.hostileValueEvidence.length === 0) {
      throw new Error(`${entry.sink} has no hostile-value test.`);
    }
    for (const evidence of entry.hostileValueEvidence) {
      assertNonBlank(evidence, `${entry.sink} evidence path`);
      if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(evidence)) {
        throw new Error(`${entry.sink} hostile-value evidence is not a test: ${evidence}.`);
      }
    }
    for (const evidence of [...entry.proofEvidence, ...entry.hostileValueEvidence]) {
      assertNonBlank(evidence, `${entry.sink} evidence path`);
      const resolvedEvidence = resolve(repositoryRoot, evidence);
      const relativeEvidence = relative(repositoryRoot, resolvedEvidence);
      if (relativeEvidence.startsWith('..') || isAbsolute(relativeEvidence)) {
        throw new Error(`${entry.sink} evidence escapes the repository: ${evidence}.`);
      }
      if (!existsSync(resolvedEvidence)) {
        throw new Error(`${entry.sink} cites stale evidence: ${evidence}.`);
      }
    }
  }

  const missingSinks = [...requiredSinks].filter((sink) => !seenSinks.has(sink));
  if (missingSinks.length > 0) {
    throw new Error(`C9 inventory is missing sink rows: ${missingSinks.join(', ')}.`);
  }
  const missingFamilies = [...censusFamilies].filter((family) => !coveredFamilies.has(family));
  if (missingFamilies.length > 0) {
    throw new Error(`C9 inventory is missing census families: ${missingFamilies.join(', ')}.`);
  }
  const missingOperations = [...requiredOperations].filter(
    (operation) => !seenOperations.has(operation),
  );
  if (missingOperations.length > 0) {
    throw new Error(
      `C9 inventory is missing finite security operations: ${missingOperations.join(', ')}.`,
    );
  }
}

function mutableBoundaryInventory(): BoundaryCrossingSinkInventoryEntry[] {
  return boundaryCrossingSinkInventory().map((entry) => ({
    ...entry,
    censusFamilies: [...entry.censusFamilies],
    hostileValueEvidence: [...entry.hostileValueEvidence],
    operationKinds: [...entry.operationKinds],
    proofEvidence: [...entry.proofEvidence],
  }));
}

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
    expect(inventory.map((entry) => entry.sink)).toEqual(requiredC9SinkNames);

    for (const entry of inventory) {
      expect(entry.censusFamilies.length, entry.sink).toBeGreaterThan(0);
      expect(entry.mechanismDetail).not.toBe('');
      expect(entry.owner).not.toBe('');
      expect(entry.operationKinds).toBeDefined();
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
        ['request method/authority/scheme', 'reconstruct'],
        ['webhook payload', 'own'],
        ['HTML/render output', 'reconstruct'],
        ['log/error output', 'box'],
        ['outbound egress request', 'own'],
        ['authorization principal/data access', 'own'],
        ['Better Auth credential/non-egress', 'own'],
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
    const requestIngressDoor = inventory.find(
      (entry) => entry.sink === 'request method/authority/scheme',
    );
    expect(requestIngressDoor?.censusFamilies).toEqual(['ingress.endpoint.webhook']);
    expect(requestIngressDoor?.soleDoor).toContain('createRequestIngressClassifier');
    expect(requestIngressDoor?.hostileValueEvidence).toContain(
      'packages/server/src/__bugz_remote_ingress.test.ts',
    );
    expect(inventory.find((entry) => entry.sink === 'HTML/render output')?.censusFamilies).toEqual([
      'html.dom.output',
      'document.shell.output',
      'css.style.output',
    ]);
    expect(
      inventory.find((entry) => entry.sink === 'outbound egress request')?.censusFamilies,
    ).toEqual(['network.egress']);
    const credentialDoor = inventory.find(
      (entry) => entry.sink === 'Better Auth credential/non-egress',
    );
    expect(credentialDoor?.censusFamilies).toEqual(['auth.credential.non-egress']);
    expect(credentialDoor?.soleDoor).toContain('runBetterAuthCredentialConsumer');
    expect(credentialDoor?.soleDoor).toContain('runBetterAuthCredentialSourceCallable{Async}');
    expect(credentialDoor?.soleDoor).toContain('consumeBetterAuthCredentialResult');
    expect(credentialDoor?.hostileValueEvidence).toContain(
      'packages/better-auth/src/internal.trusted-plaintext.test.ts',
    );
  });

  it('assigns every finite compiler-owned operation to exactly one C9 sink owner', () => {
    const assigned = boundaryCrossingSinkInventory().flatMap((entry) => entry.operationKinds);
    expect([...assigned].sort()).toEqual([...securityOperationKinds].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('keeps every owner, proof gate, and hostile-value citation live', () => {
    expect(() =>
      assertC9SinkInventoryComplete(
        frameworkSourceSinkInventory(),
        boundaryCrossingSinkInventory(),
      ),
    ).not.toThrow();
  });

  it.each([
    {
      expected: /missing sink rows: Set-Cookie/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) =>
        inventory.filter((entry) => entry.sink !== 'Set-Cookie'),
      name: 'missing row',
    },
    {
      expected: /Duplicate C9 sink row/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [inventory[0]!, ...inventory],
      name: 'duplicate row',
    },
    {
      expected: /owner must be non-blank/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, owner: '  ' },
        ...inventory.slice(1),
      ],
      name: 'unowned row',
    },
    {
      expected: /unknown source\/sink census family/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, censusFamilies: ['not.a.real.sink'] },
        ...inventory.slice(1),
      ],
      name: 'unknown census family',
    },
    {
      expected: /does not cite a live root proof gate/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, proofGate: 'pnpm run check:not-real' },
        ...inventory.slice(1),
      ],
      name: 'missing proof gate',
    },
    {
      expected: /missing finite security operations: browser\.state\.write/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) =>
        inventory.map((entry) => ({
          ...entry,
          operationKinds: entry.operationKinds.filter(
            (operation) => operation !== 'browser.state.write',
          ),
        })),
      name: 'missing finite operation owner',
    },
    {
      expected: /Duplicate C9 finite security-operation owner/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        {
          ...inventory[0]!,
          operationKinds: [...inventory[0]!.operationKinds, 'browser.state.write' as const],
        },
        ...inventory.slice(1),
      ],
      name: 'duplicate finite operation owner',
    },
    {
      expected: /hostile-value evidence is not a test/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, hostileValueEvidence: ['SPEC.md'] },
        ...inventory.slice(1),
      ],
      name: 'non-test hostile evidence',
    },
    {
      expected: /evidence path must be non-blank/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, hostileValueEvidence: [''] },
        ...inventory.slice(1),
      ],
      name: 'empty hostile evidence',
    },
    {
      expected: /cites stale evidence/u,
      mutate: (inventory: BoundaryCrossingSinkInventoryEntry[]) => [
        { ...inventory[0]!, hostileValueEvidence: ['packages/core/src/not-real.test.ts'] },
        ...inventory.slice(1),
      ],
      name: 'stale hostile evidence',
    },
  ])('fails closed for a $name', ({ expected, mutate }) => {
    expect(() =>
      assertC9SinkInventoryComplete(
        frameworkSourceSinkInventory(),
        mutate(mutableBoundaryInventory()),
      ),
    ).toThrow(expected);
  });

  it.each(['brand', 'sentinel', 'proxy', 'static-diagnostic'])(
    'does not treat %s as a boundary-crossing mechanism',
    (mechanism) => {
      const inventory = mutableBoundaryInventory();
      expect(Reflect.set(inventory[0]!, 'mechanism', mechanism)).toBe(true);

      expect(() =>
        assertC9SinkInventoryComplete(frameworkSourceSinkInventory(), inventory),
      ).toThrow(/unknown boundary-crossing mechanism/u);
    },
  );

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
