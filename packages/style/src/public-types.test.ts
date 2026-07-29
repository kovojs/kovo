import { describe, expect, it } from 'vitest';

import { attrs, create, type StyleHandle, type StyleInput } from './index.js';

function opaqueHandleTypeContract(): StyleHandle {
  const styles = create({ root: { color: 'red' } });
  const handle: StyleHandle = styles.root;
  const input: StyleInput = [handle, false, [undefined, handle]];
  attrs(input);

  // @ts-expect-error A structural object is not a framework-created StyleHandle.
  attrs({ color: 'red' });
  // @ts-expect-error Source/provenance identity is compiler-owned, not public create input.
  create({ root: { color: 'red' } }, { source: 'forged.tsx' });
  // @ts-expect-error The retired raw tuple is not part of StyleInput.
  const legacyTuple: StyleInput = [null, { color: 'red' }];
  void legacyTuple;
  return handle;
}

describe('@kovojs/style public types', () => {
  it('keeps opaque handle construction behind style.create', () => {
    expect(opaqueHandleTypeContract).toBeTypeOf('function');
  });
});
