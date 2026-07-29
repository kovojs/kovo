import { readFile } from 'node:fs/promises';

import { it } from 'vitest';

import { evaluateD1V6 } from './evaluator-v6.ts';
import { runD1V6Experiment } from './experiment-v6.ts';
import type { D1CriteriaV6 } from './types-v6.ts';

it('prints temporary canonicalization diagnostics', async () => {
  const criteria = JSON.parse(
    await readFile(new URL('../criteria-v6.json', import.meta.url), 'utf8'),
  ) as D1CriteriaV6;
  const evidence = await runD1V6Experiment(criteria);
  const evaluated = await evaluateD1V6(criteria, evidence);
  process.stdout.write(
    `${JSON.stringify(
      {
        arms: evaluated.arms,
        differences: Object.fromEntries(
          Object.entries(evidence.compiler.families).map(([family, variants]) => [
            family,
            {
              armA: firstDifference(
                variants.baseline.canonicalIr.canonical,
                variants['arm-a'].canonicalIr.canonical,
              ),
              armB: firstDifference(
                variants.baseline.canonicalIr.canonical,
                variants['arm-b'].canonicalIr.canonical,
              ),
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}, 120_000);

function firstDifference(
  left: unknown,
  right: unknown,
  path = '$',
): { readonly left: unknown; readonly path: string; readonly right: unknown } | undefined {
  if (JSON.stringify(left) === JSON.stringify(right)) return undefined;
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return { left, path, right };
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return { left, path, right };
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return { left, path, right };
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return { left, path, right };
}
