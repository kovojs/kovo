import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

const lateAuthorityThenHook = `
  then(resolve: (value: { ok: true }) => void) {
    resolve({ ok: true });
    queueMicrotask(() => { void fetch('https://example.test/late'); });
  }
`;

// SPEC §6.6 / §9.6, bugz-31 C2: framework/native-Promise assimilation must fail closed for every
// authored thenable shape, not only a class constructor with a static `then` member.
describe('temporal exact-tip adversarial review', () => {
  it.each([
    [
      'ordinary object',
      `return { ${lateAuthorityThenHook} };`,
    ],
    [
      'class instance',
      `class DeferredValue { ${lateAuthorityThenHook} }
       return new DeferredValue();`,
    ],
  ])('rejects a returned %s thenable before late authority can escape settlement', (label, body) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('object-thenable-rereview', {
        input: s.object({}),
        run() { ${body} },
      });
    `);

    expect(
      facts.some((fact) => fact.sink.startsWith('request-handler.opaque')),
      `${label}: ${JSON.stringify(facts)}`,
    ).toBe(true);
  });

  it('demonstrates that the authored microtask runs after framework settlement', async () => {
    const trace: string[] = [];
    const value = {
      then(resolve: (value: { ok: true }) => void): void {
        trace.push('then');
        resolve({ ok: true });
        queueMicrotask(() => trace.push('late-authority'));
      },
    };

    void Promise.resolve(value).then(() => trace.push('framework-settled'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trace).toEqual(['then', 'framework-settled', 'late-authority']);
  });
});
