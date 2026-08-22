import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
  DEV_PORT_ALLOCATION_POSTURE,
  DEV_PORT_ALLOCATION_SCHEMA,
  inspectDevPortAllocation,
  inspectHostEphemeralPortRanges,
  validateDevPortAllocationEvidence,
} from './dev-port-allocation.mjs';

describe('authenticated dev port allocation', () => {
  it('records the bounded Linux kernel source and admits exact ports below its range', async () => {
    const bytes = Buffer.from('32768\t60999\n');
    const host = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => bytes,
    });

    expect(host).toEqual({
      complete: true,
      error: null,
      platform: 'linux',
      probe: {
        bytes: bytes.byteLength,
        contentBase64: bytes.toString('base64'),
        kind: 'procfs',
        locator: '/proc/sys/net/ipv4/ip_local_port_range',
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      },
      ranges: [{ label: 'default', maximum: 60_999, minimum: 32_768 }],
      schema: DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
      scope: 'tcp-loopback-v4-v6/v1',
    });

    await expect(
      inspectDevPortAllocation(
        { basePort: 20_000, inspectorPorts: [21_000], ports: [20_000, 20_001] },
        { inspectHostRanges: async () => host },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        complete: true,
        errors: [],
        inspectorPorts: [21_000],
        overlaps: [],
        ports: [20_000, 20_001],
        posture: DEV_PORT_ALLOCATION_POSTURE,
        schema: DEV_PORT_ALLOCATION_SCHEMA,
      }),
    );
  });

  it('normalizes and authenticates all bounded macOS default/high/low ranges', async () => {
    const bytes = Buffer.from('49152\n65535\n49152\n65535\n1023\n600\n');
    const host = await inspectHostEphemeralPortRanges({
      platform: 'darwin',
      readDarwinRanges: async () => bytes,
    });

    expect(host).toMatchObject({
      complete: true,
      platform: 'darwin',
      probe: { kind: 'sysctl', sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) },
      ranges: [
        { label: 'default', maximum: 65_535, minimum: 49_152 },
        { label: 'high', maximum: 65_535, minimum: 49_152 },
        { label: 'low', maximum: 1_023, minimum: 600 },
      ],
    });
  });

  it('fails closed before timing on overlap, unknown platform, or incomplete discovery', async () => {
    const safeHost = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => Buffer.from('32768 60999\n'),
    });
    const overlap = await inspectDevPortAllocation(
      { basePort: 49_750, inspectorPorts: [], ports: [49_750, 49_751] },
      { inspectHostRanges: async () => safeHost },
    );
    expect(overlap).toMatchObject({
      complete: false,
      overlaps: [
        { kind: 'dev-session', label: 'default', port: 49_750 },
        { kind: 'dev-session', label: 'default', port: 49_751 },
      ],
    });
    expect(overlap.errors[0]).toContain('overlap host ephemeral ranges');

    const unknown = await inspectHostEphemeralPortRanges({ platform: 'aix' });
    expect(unknown).toMatchObject({
      complete: false,
      platform: 'aix',
      probe: null,
      ranges: [],
    });
    const unproven = await inspectDevPortAllocation(
      { basePort: 20_000, inspectorPorts: [], ports: [20_000] },
      { inspectHostRanges: async () => unknown },
    );
    expect(unproven.complete).toBe(false);
    expect(unproven.errors[0]).toContain('host ephemeral port range is unproven');
  });

  it('rejects duplicate server/Inspector identities and tampered evidence', async () => {
    const host = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => Buffer.from('32768 60999\n'),
    });
    const duplicate = await inspectDevPortAllocation(
      { basePort: 20_000, inspectorPorts: [20_001], ports: [20_000, 20_001] },
      { inspectHostRanges: async () => host },
    );
    expect(duplicate.complete).toBe(false);
    expect(duplicate.errors).toContain('dev server and Inspector ports are not globally unique');

    expect(() =>
      validateDevPortAllocationEvidence({
        ...duplicate,
        complete: true,
      }),
    ).toThrow(/completeness disagrees/u);

    expect(() =>
      validateDevPortAllocationEvidence({
        ...duplicate,
        errors: [],
      }),
    ).toThrow(/errors differ from their canonical derivation/u);

    const admitted = await inspectDevPortAllocation(
      { basePort: 20_000, inspectorPorts: [], ports: [20_000, 20_001] },
      { inspectHostRanges: async () => host },
    );
    expect(() =>
      validateDevPortAllocationEvidence({
        ...admitted,
        basePort: 20_001,
      }),
    ).toThrow(/errors differ from their canonical derivation/u);

    expect(() =>
      validateDevPortAllocationEvidence({
        ...admitted,
        complete: false,
        errors: ['invented allocation failure'],
      }),
    ).toThrow(/errors differ from their canonical derivation/u);

    expect(() =>
      validateDevPortAllocationEvidence({
        ...admitted,
        hostEphemeral: {
          ...admitted.hostEphemeral,
          ranges: [{ label: 'default', maximum: 61_000, minimum: 32_768 }],
        },
      }),
    ).toThrow(/differ from their retained kernel bytes/u);

    const zeroBytes = Buffer.alloc(host.probe.bytes);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...admitted,
        hostEphemeral: {
          ...admitted.hostEphemeral,
          probe: {
            ...admitted.hostEphemeral.probe,
            contentBase64: zeroBytes.toString('base64'),
            sha256: `sha256:${createHash('sha256').update(zeroBytes).digest('hex')}`,
          },
        },
      }),
    ).toThrow(/non-integer range evidence/u);
  });

  it('reconstructs exhaustive Linux overlaps instead of trusting a complete claim', async () => {
    const host = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => Buffer.from('20000 21000\n'),
    });
    const overlap = await inspectDevPortAllocation(
      { basePort: 20_024, inspectorPorts: [21_024], ports: [20_024, 20_025] },
      { inspectHostRanges: async () => host },
    );

    expect(overlap).toMatchObject({
      complete: false,
      overlaps: [
        { kind: 'dev-session', label: 'default', port: 20_024 },
        { kind: 'dev-session', label: 'default', port: 20_025 },
      ],
    });
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        complete: true,
        errors: [],
        overlaps: [],
      }),
    ).toThrow(/overlaps differ from their canonical derivation/u);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        errors: [],
      }),
    ).toThrow(/errors differ from their canonical derivation/u);
  });

  it('binds Inspector overlap identity, exhaustive membership, and canonical order', async () => {
    const host = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => Buffer.from('20000 21000\n'),
    });
    const overlap = await inspectDevPortAllocation(
      { basePort: 20_024, inspectorPorts: [21_000], ports: [20_024, 20_025] },
      { inspectHostRanges: async () => host },
    );

    expect(overlap.overlaps).toEqual([
      { kind: 'dev-session', label: 'default', port: 20_024 },
      { kind: 'dev-session', label: 'default', port: 20_025 },
      { kind: 'inspector', label: 'default', port: 21_000 },
    ]);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        overlaps: overlap.overlaps.slice(0, -1),
      }),
    ).toThrow(/overlaps differ from their canonical derivation/u);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        overlaps: [
          ...overlap.overlaps.slice(0, -1),
          { ...overlap.overlaps.at(-1), kind: 'dev-session' },
        ],
      }),
    ).toThrow(/overlap evidence is malformed/u);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        overlaps: [...overlap.overlaps, overlap.overlaps[0]],
      }),
    ).toThrow(/overlaps differ from their canonical derivation/u);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...overlap,
        overlaps: [...overlap.overlaps].reverse(),
      }),
    ).toThrow(/overlaps differ from their canonical derivation/u);
  });

  it('binds base and host-discovery failures into the canonical error ledger', async () => {
    const host = await inspectHostEphemeralPortRanges({ platform: 'aix' });
    const failed = await inspectDevPortAllocation(
      { basePort: 20_025, inspectorPorts: [], ports: [20_024] },
      { inspectHostRanges: async () => host },
    );

    expect(failed.errors).toEqual([
      'dev port base does not equal the first exact session port',
      expect.stringContaining('host ephemeral port range is unproven'),
    ]);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...failed,
        errors: failed.errors.slice(1),
      }),
    ).toThrow(/errors differ from their canonical derivation/u);
    expect(() =>
      validateDevPortAllocationEvidence({
        ...failed,
        errors: failed.errors.slice(0, 1),
      }),
    ).toThrow(/errors differ from their canonical derivation/u);
  });

  it('never invokes a Darwin shell and bounds the platform reader seam', async () => {
    const readDarwinRanges = vi.fn(async () => Buffer.alloc(4_097, 0x31));
    const host = await inspectHostEphemeralPortRanges({ platform: 'darwin', readDarwinRanges });
    expect(readDarwinRanges).toHaveBeenCalledOnce();
    expect(host).toMatchObject({ complete: false, probe: null, ranges: [] });
    expect(host.error).toContain('exceeds its evidence bound');
  });
});
