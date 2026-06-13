import { describe, expect, it } from 'vitest';

import { normalizeStaticExportHtmlPathStyle } from './static-export-options.js';
import type {
  StaticExportNonExportablePolicy,
  StaticExportOptions,
} from './static-export-types.js';

describe('server static export option boundary', () => {
  it('owns SPEC §9.5 html document path-style normalization for export and replay callers', () => {
    expect(normalizeStaticExportHtmlPathStyle(undefined)).toBe('directory');
    expect(normalizeStaticExportHtmlPathStyle('directory')).toBe('directory');
    expect(normalizeStaticExportHtmlPathStyle('flat')).toBe('flat');

    expect(() => normalizeStaticExportHtmlPathStyle('pretty' as 'directory')).toThrow(
      /FW229 static export refused htmlPathStyle 'pretty'/,
    );
  });

  it('exposes one non-exportable policy type through the public option surface', () => {
    const policy: StaticExportNonExportablePolicy = 'skip';
    const options = {
      onNonExportable: policy,
    } satisfies Pick<StaticExportOptions, 'onNonExportable'>;

    expect(options.onNonExportable).toBe('skip');
  });
});
