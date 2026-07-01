import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot() {
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
}
