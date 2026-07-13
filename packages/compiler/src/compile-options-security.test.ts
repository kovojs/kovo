import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const componentSource = `
import { component } from '@kovojs/core';

export const Greeting = component({
  render() {
    return <p>Reviewed compiler input</p>;
  },
});
`;

describe('compiler option authority', () => {
  it('rejects accessors without invoking them at the compile boundary', () => {
    let reads = 0;
    const options = {
      fileName: 'src/greeting.tsx',
      get source() {
        reads += 1;
        return componentSource;
      },
    };

    expect(() => compileComponentModule(options)).toThrow(/source.*changed while/u);
    expect(reads).toBe(0);
  });
});
