import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  revalidateKovoBuildConfigTrustSourceSnapshot,
  snapshotKovoBuildConfigTrustSources,
} from './build-export.js';

describe('build config trust source handoff', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'kovo-config-trust-handoff-'));
    roots.push(root);
    const configPath = join(root, 'kovo.config.ts');
    writeFileSync(configPath, "import './preset';\nexport default {};\n");
    writeFileSync(join(root, 'preset.js'), "export const preset = 'node';\n");
    return { configPath, root };
  }

  it('accepts the exact descriptor-read config path and closure bytes', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);

    expect(
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, configPath, 'check'),
    ).toEqual(approved);
  });

  it('rejects an imported config source byte change', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);
    writeFileSync(join(root, 'preset.js'), "export const preset = 'cloudflare';\n");

    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, configPath, 'check'),
    ).toThrow('Kovo check handoff config source is stale.');
  });

  it('rejects a config path swap even when the replacement bytes are identical', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);
    const replacement = join(root, 'kovo.config.mts');
    writeFileSync(replacement, "import './preset';\nexport default {};\n");

    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, replacement, 'build'),
    ).toThrow('Kovo build handoff config source is stale.');
  });

  it('rejects extension-resolution drift from a newly shadowing relative module', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);
    writeFileSync(join(root, 'preset.ts'), "export const preset = 'vercel';\n");

    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, configPath, 'check'),
    ).toThrow('Kovo check handoff config source is stale.');
  });

  it('rejects a relative source replaced by an outside-root symlink', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);
    const outside = mkdtempSync(join(tmpdir(), 'kovo-config-trust-outside-'));
    roots.push(outside);
    const outsidePreset = join(outside, 'preset.js');
    writeFileSync(outsidePreset, "export const preset = 'attacker';\n");
    renameSync(join(root, 'preset.js'), join(root, 'preset.original.js'));
    symlinkSync(outsidePreset, join(root, 'preset.js'));

    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, configPath, 'check'),
    ).toThrow(/symbolic link|special entry/u);
  });

  it('rejects config creation or removal across the handoff', () => {
    const { configPath, root } = fixture();
    const approved = snapshotKovoBuildConfigTrustSources(configPath, root);

    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(undefined, root, configPath, 'check'),
    ).toThrow('Kovo check handoff config source is stale.');
    expect(() =>
      revalidateKovoBuildConfigTrustSourceSnapshot(approved, root, undefined, 'check'),
    ).toThrow('Kovo check handoff config source is stale.');
  });
});
