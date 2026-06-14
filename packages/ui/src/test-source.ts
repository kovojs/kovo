import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceDir = dirname(fileURLToPath(import.meta.url));

export function readSource(name: string): string {
  return readFileSync(join(sourceDir, name), 'utf8');
}
