import type { jiso } from '../../../packages/drizzle/src/static.js';

export function annotatedTable(name: string, annotation: ReturnType<typeof jiso>) {
  return {
    domain: annotation.domain,
    ...(annotation.key ? { key: annotation.key } : {}),
    name,
  };
}

export function drizzleSymbol(name: string): symbol {
  return Symbol.for(`drizzle:${name}`);
}
