import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { integrationSpecInventoryEntry } from './integration/spec-inventory.ts';

describe('integration spec inventory', () => {
  it('classifies every current integration spec by owner axis and CI tier', () => {
    const unclassified = specFiles().filter((file) => !integrationSpecInventoryEntry(file));

    expect(unclassified).toEqual([]);
  });

  it('fails closed for an unclassified spec name', () => {
    expect(integrationSpecInventoryEntry('new-unknown-behavior.spec.ts')).toBeUndefined();
  });
});

function specFiles(): string[] {
  return readdirSync('tests/integration/specs', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => relative(process.cwd(), join('tests/integration/specs', entry.name)))
    .sort((a, b) => a.localeCompare(b));
}
