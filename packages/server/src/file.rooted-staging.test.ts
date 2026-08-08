import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O16 (SPEC §14; plans/good-perf.md): the generated production server entry publishes
 * `KOVO_ROOTED_FILES_DIR` before importing the handler graph, and `rootedFiles()` then resolves
 * every RELATIVE root against the artifact's staged `rooted/root-<encoded>` copies instead of
 * against the launch working directory. Absolute roots keep naming live deploy-host paths.
 *
 * The env var is boot-read at module initialization (matching the generated entry's ordering),
 * so each case re-imports a fresh module instance under a stubbed environment.
 */
describe('rootedFiles staged root resolution (SPEC §14, O16)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves relative roots against the staged artifact directory when published', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-rooted-staged-'));
    try {
      const spec = '../shared/images';
      const stagedRoot = join(base, `root-${encodeURIComponent(spec)}`);
      await mkdir(stagedRoot, { recursive: true });
      await writeFile(join(stagedRoot, 'product-01.webp'), 'staged-artifact-bytes');

      vi.stubEnv('KOVO_ROOTED_FILES_DIR', base);
      vi.resetModules();
      const { rootedFiles } = await import('./file.js');
      const files = await rootedFiles(spec);
      expect(files.root.endsWith(`root-${encodeURIComponent(spec)}`)).toBe(true);
      const outcome = await files.serve('product-01.webp', {
        contentType: 'application/octet-stream',
        disposition: 'attachment',
      });
      expect(outcome).toBeDefined();
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('fails closed when the published staged directory lacks the relative root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-rooted-staged-missing-'));
    try {
      vi.stubEnv('KOVO_ROOTED_FILES_DIR', base);
      vi.resetModules();
      const { rootedFiles } = await import('./file.js');
      // The staged directory exists but was never populated for this spec: the artifact is
      // incomplete and boot must fail closed instead of silently reading the launch cwd.
      await expect(rootedFiles('../shared/images')).rejects.toThrow(/does not exist/u);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('leaves absolute roots pointing at live host paths even when staging is published', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-rooted-staged-abs-'));
    const hostDir = await mkdtemp(join(tmpdir(), 'kovo-rooted-host-'));
    try {
      await writeFile(join(hostDir, 'live.txt'), 'live-host-bytes');
      vi.stubEnv('KOVO_ROOTED_FILES_DIR', base);
      vi.resetModules();
      const { rootedFiles } = await import('./file.js');
      const files = await rootedFiles(hostDir);
      const outcome = await files.serve('live.txt', {
        contentType: 'application/octet-stream',
        disposition: 'attachment',
      });
      expect(outcome).toBeDefined();
    } finally {
      await rm(base, { force: true, recursive: true });
      await rm(hostDir, { force: true, recursive: true });
    }
  });

  it('records constructed roots in the build inventory with their original specs', async () => {
    const hostDir = await mkdtemp(join(tmpdir(), 'kovo-rooted-inventory-'));
    try {
      vi.resetModules();
      const { rootedFiles, rootedFilesBuildInventory } = await import('./file.js');
      await rootedFiles(hostDir);
      const inventory = rootedFilesBuildInventory();
      const entry = inventory.find((candidate) => candidate.spec === hostDir);
      expect(entry).toBeDefined();
      expect(entry!.root.endsWith(hostDir.slice(hostDir.lastIndexOf('/') + 1))).toBe(true);
    } finally {
      await rm(hostDir, { force: true, recursive: true });
    }
  });
});
