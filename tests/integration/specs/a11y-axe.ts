import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { expect } from '@kovojs/test/internal/integration';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

let axeSource: Promise<string> | undefined;

export async function expectAxeClean(
  page: import('@kovojs/test/internal/integration').Page,
): Promise<void> {
  axeSource ??= readFile(axePath, 'utf8');
  await page.addScriptTag({ content: await axeSource });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (context: Document) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ failureSummary?: string; target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document);
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        summary: node.failureSummary ?? '',
        target: node.target.join(' '),
      })),
    }));
  });

  expect(violations).toEqual([]);
}
