import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function charsetDiagnostics(element: string, prelude = '') {
  const result = compileComponentModule({
    fileName: 'src/html-charset-exact-tip-review.tsx',
    source: `${prelude}
export const View = component({ render: () => <form>${element}</form> });`,
  });
  return result.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === 'KV236' && diagnostic.message.includes('reserved-charset-hidden-control'),
  );
}

describe('hidden _charset_ exact-tip compiler review (SPEC §13.2/§6.6)', () => {
  it.each([
    [
      'module-constant computed keys',
      '<input {...{ [TYPE]: "hidden", [NAME]: "_charset_" }} />',
      "const TYPE = 'type'; const NAME = 'name';",
    ],
    [
      'false same-key override exposing a later case-folded type',
      '<input TYPE="hidden" {...{ TYPE: false, type: "hidden", name: "_charset_" }} />',
      '',
    ],
    [
      'null same-key override exposing a later case-folded name',
      '<input type="hidden" NAME="_charset_" {...{ NAME: null, name: "_charset_" }} />',
      '',
    ],
    [
      'nested fully-static object spread',
      '<input {...{ ...{ type: "hidden" }, name: "_charset_" }} />',
      '',
    ],
  ])('rejects the compiler-known reserved tuple from %s', (_label, element, prelude) => {
    // These tuples are completely determined at compile time. The emitted JSX runtime still
    // aborts them, but SPEC §13.2 promises compiler-known violations are build errors rather than
    // latent route-render failures.
    expect(charsetDiagnostics(element, prelude)).not.toEqual([]);
  });
});
