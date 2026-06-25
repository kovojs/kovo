import { describe, expect, it } from 'vitest';

import { createJsxIrTree } from './jsx-ir.js';
import { parseComponentModule } from './scan/parse.js';

describe('createJsxIrTree', () => {
  it('assembles parent and child links for a deeply nested JSX tree', () => {
    const depth = 80;
    const open = Array.from({ length: depth }, (_, index) => `<node-${index}>`).join('');
    const close = Array.from({ length: depth }, (_, index) => `</node-${depth - index - 1}>`).join(
      '',
    );
    const source = `
export const DeepTree = component({
  render: () => (${open}leaf${close}),
});
`;
    const model = parseComponentModule('deep-tree.tsx', source);
    const tree = createJsxIrTree(model, { fileName: 'deep-tree.tsx', source });

    expect(tree.roots).toHaveLength(1);
    expect(tree.elements).toHaveLength(depth);

    for (let index = 1; index < tree.elements.length; index += 1) {
      expect(tree.elements[index].parent).toBe(tree.elements[index - 1]);
    }

    for (let index = 0; index < tree.elements.length - 1; index += 1) {
      expect(tree.elements[index].children.find((child) => child.kind === 'element')).toBe(
        tree.elements[index + 1],
      );
    }
  });
});
