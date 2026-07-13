import { describe, expect, it } from 'vitest';

import { compileFrameworkComponentModule } from './mcp.js';

function componentSource(marker: string): string {
  return `
import { component } from '@kovojs/core';

export const Greeting = component({
  render() {
    return <p>${marker}</p>;
  },
});
`;
}

describe('framework compiler option authority', () => {
  it('pins source before the first asynchronous module-load yield', async () => {
    const options = {
      fileName: 'src/framework-greeting.tsx',
      source: componentSource('REVIEWED_SOURCE'),
    };

    const pending = compileFrameworkComponentModule(options);
    options.source = componentSource('SUBSTITUTED_SOURCE');
    const result = await pending;
    const emitted = result.files.map((file) => file.source).join('\n');

    expect(emitted).toContain('REVIEWED_SOURCE');
    expect(emitted).not.toContain('SUBSTITUTED_SOURCE');
  });
});
