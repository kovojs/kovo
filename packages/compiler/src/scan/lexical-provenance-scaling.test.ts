// plans/good-perf.md O7: a legitimate app must not become unbuildable purely by growing.
//
// The measured wall: a flat entry importing N components passed `kovo check` at N=125 and failed
// closed at N=130 with KV448 ("framework root is reached through mutable or ambiguous lexical
// provenance"). Root cause was NOT the 16,384-step abstract work budget the ledger suspected —
// instrumented at N=130 the module consumes only ~540 work units — but the fixed 128-entry
// effect-site history cap in scan/lexical-provenance.ts: every module-scope JSX element is one
// opaque call that records an unmodeled-effect site, so the 129th component exhausted the budget
// and `budgetExhausted` widened every use into the KV448 refusal. The budget now scales with the
// module's own syntax-node count (floor 128, ceiling 4,096); exhaustion still fails closed.
import { describe, expect, it } from 'vitest';

import { scanCapabilityClosureModules } from './capability-closure.js';

function flatEntry(componentCount: number): string {
  const imports: string[] = [];
  const jsx: string[] = [];
  for (let index = 0; index < componentCount; index += 1) {
    imports.push(`import { Card${index} } from './components/card-${index}.tsx';`);
    jsx.push(`      <Card${index} />`);
  }
  return `/** @jsxImportSource @kovojs/server */
import { defineKovo } from '@kovojs/server';
${imports.join('\n')}

const app = defineKovo({ appId: 'scaling-probe' });

app.route('/', () => (
  <main>
${jsx.join('\n')}
  </main>
));

export default app.assemble();
`;
}

function budgetExhausted(source: string): boolean {
  const [module] = scanCapabilityClosureModules([{ fileName: 'src/app.tsx', source }]);
  return module!.lexicalProvenanceBudgetExhausted === true;
}

describe('lexical-provenance effect-site budget scales with module size (O7)', () => {
  it.each([125, 130, 200, 400, 1000])(
    'keeps a flat %i-component entry inside the analysis budget',
    (componentCount) => {
      // 130 is the exact former wall; 400 matches the O7 synthetic ladder's largest rung.
      expect(budgetExhausted(flatEntry(componentCount))).toBe(false);
    },
  );

  it('still fails closed on a module whose site history exceeds the scaled ceiling', () => {
    // A single module recording well past the 4,096-site ceiling remains a refusal: the cap
    // bounds analyzer time/memory on adversarial input, and exhaustion stays fail-closed.
    const calls: string[] = [];
    for (let index = 0; index < 6000; index += 1) {
      calls.push(`opaque(${index});`);
    }
    const source = `import { opaque } from './opaque.ts';\n${calls.join('\n')}\nexport {};\n`;
    expect(budgetExhausted(source)).toBe(true);
  });

  it('keeps exact verdicts for small modules unchanged (floor budget)', () => {
    expect(budgetExhausted(flatEntry(10))).toBe(false);
  });
});
