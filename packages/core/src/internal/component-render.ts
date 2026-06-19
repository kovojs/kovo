// Re-exported from the leaf `../forms-types.js` module so this internal subpath
// stays stable without forming an `index.ts <-> internal/component-render.ts`
// barrel cycle the dts bundler cannot emit (SPEC §4.5/§6.3).
export type { ComponentMutationDefinitions, ComponentMutationForms } from '../forms-types.js';
