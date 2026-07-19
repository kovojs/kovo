import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function kv236Diagnostics(source: string) {
  return compileComponentModule({ fileName: 'pair-dependent-sink.tsx', source }).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV236',
  );
}

describe('pair-dependent dynamic navigation sinks', () => {
  it('rejects state-derived meta refresh content before it can become a live navigation', () => {
    const diagnostics = kv236Diagnostics(`
export const Refresh = component({
  state: () => ({ target: '0; url=https://attacker.example/collect' }),
  render: (_queries, state) => (
    <meta http-equiv="refresh" content={state.target} />
  ),
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('meta refresh'),
        }),
      ]),
    );
  });

  it('rejects state-derived base href before it can retarget document-relative actions', () => {
    const diagnostics = kv236Diagnostics(`
export const Base = component({
  state: () => ({ target: 'https://attacker.example/' }),
  render: (_queries, state) => <base href={state.target} />,
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('base'),
        }),
      ]),
    );
  });
});
