import {
  component as defineComponent,
  type Component,
  type ComponentDefinitionInput,
} from '@kovojs/core';

import { formHelperApply, formHelperOwnDataValue } from './jsx-form-helper-intrinsics.js';

const componentDescriptorVerifierKey = '__kovoIsComponentDescriptor';

/** Verify component provenance through core's module-private descriptor witness. */
export function isKovoComponentDescriptor(
  value: unknown,
): value is Component<ComponentDefinitionInput> {
  const verifier = formHelperOwnDataValue(defineComponent, componentDescriptorVerifierKey);
  return (
    typeof verifier === 'function' && formHelperApply(verifier, defineComponent, [value]) === true
  );
}
