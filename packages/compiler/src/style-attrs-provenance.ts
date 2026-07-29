import type { JsxSpreadAttributeModel } from './scan/model.js';

type StyleAttrsReturnedWireKey = 'class' | 'style';

/**
 * SPEC §4.7 / §5.2 rule 10: the exact framework helper returns only this finite string-key set
 * after validating every input as a framework-created opaque style handle. Build-owned symbol
 * provenance is non-wire metadata. Output-context validation may use the wire set only after
 * proving the call's @kovojs/style export provenance; same-named local or third-party helpers
 * remain opaque.
 */
const styleAttrsReturnedWireKeys: readonly StyleAttrsReturnedWireKey[] = ['class', 'style'];

/** Exact framework-export provenance plus the helper's finite returned wire-key summary. */
export function frameworkStyleAttrsReturnedWireKeys(
  attribute: JsxSpreadAttributeModel,
): readonly StyleAttrsReturnedWireKey[] | undefined {
  return attribute.expressionCallImportedName === 'attrs' &&
    attribute.expressionCallModuleSpecifier === '@kovojs/style'
    ? styleAttrsReturnedWireKeys
    : undefined;
}
