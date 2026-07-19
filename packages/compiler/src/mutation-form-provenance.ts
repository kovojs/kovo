import {
  compilerSnapshotDenseArray,
  compilerStringToLowerCase,
} from './compiler-security-intrinsics.js';
import type { JsxElementModel, JsxSpreadAttributeModel } from './scan/model.js';

export type MutationFormControlAttributeName =
  | 'data-enhance'
  | 'data-mutation'
  | 'data-mutation-stream'
  | 'enhance'
  | 'mutation';

export type MutationFormTransportAttributeName = 'action' | 'enctype' | 'method';

export type MutationFormAttributesReturnedKey =
  | 'action'
  | 'data-mutation'
  | 'enhance'
  | 'enctype'
  | 'method'
  | 'mutation';

/**
 * SPEC §6.3: the exact framework helper returns this finite key set. Output-context validation may
 * use the set only after proving the call's @kovojs/server export provenance; a same-named local
 * helper remains opaque. If the public helper ever grows another key, this reviewed denominator
 * must grow with it before that key can cross an element-context sink.
 */
const mutationFormAttributesReturnedKeys: readonly MutationFormAttributesReturnedKey[] = [
  'action',
  'data-mutation',
  'enhance',
  'enctype',
  'method',
  'mutation',
];

export type MutationSubmitterTransportAttributeName =
  | 'form'
  | 'formaction'
  | 'formenctype'
  | 'formmethod'
  | 'formnovalidate'
  | 'formtarget';

/**
 * SPEC §5.2 rule 10 / §6.3: these JSX/wire names opt a form into Kovo mutation dispatch or
 * identify that dispatch. Treat their spelling case-insensitively because HTML parsing folds
 * attribute names before the browser loader matches them.
 */
export function mutationFormControlAttributeName(
  name: string,
): MutationFormControlAttributeName | null {
  switch (compilerStringToLowerCase(name)) {
    case 'data-enhance':
      return 'data-enhance';
    case 'data-mutation':
      return 'data-mutation';
    case 'data-mutation-stream':
      return 'data-mutation-stream';
    case 'enhance':
      return 'enhance';
    case 'mutation':
      return 'mutation';
    default:
      return null;
  }
}

export function mutationFormProvenanceAttributeName(name: string): string | null {
  const control = mutationFormControlAttributeName(name);
  if (control !== null) return control;
  const formTransport = mutationFormTransportAttributeName(name);
  if (formTransport !== null) return formTransport;
  return mutationSubmitterTransportAttributeName(name);
}

export function mutationFormTransportAttributeName(
  name: string,
): MutationFormTransportAttributeName | null {
  switch (compilerStringToLowerCase(name)) {
    case 'action':
      return 'action';
    case 'enctype':
      return 'enctype';
    case 'method':
      return 'method';
    default:
      return null;
  }
}

export function mutationSubmitterTransportAttributeName(
  name: string,
): MutationSubmitterTransportAttributeName | null {
  switch (compilerStringToLowerCase(name)) {
    case 'form':
      return 'form';
    case 'formaction':
      return 'formaction';
    case 'formenctype':
      return 'formenctype';
    case 'formmethod':
      return 'formmethod';
    case 'formnovalidate':
      return 'formnovalidate';
    case 'formtarget':
      return 'formtarget';
    default:
      return null;
  }
}

export function isMutationFormAttributesSpread(attribute: JsxSpreadAttributeModel): boolean {
  return (
    isImportedMutationFormAttributesCall(attribute) &&
    attribute.expressionCallArgumentBareIdentifierName !== undefined
  );
}

export function isImportedMutationFormAttributesCall(attribute: JsxSpreadAttributeModel): boolean {
  return (
    attribute.expressionCallImportedName === 'mutationFormAttributes' &&
    attribute.expressionCallModuleSpecifier === '@kovojs/server'
  );
}

/** Exact framework-export provenance plus the helper's finite returned-key summary. */
export function frameworkMutationFormAttributesReturnedKeys(
  attribute: JsxSpreadAttributeModel,
): readonly MutationFormAttributesReturnedKey[] | undefined {
  return isImportedMutationFormAttributesCall(attribute)
    ? mutationFormAttributesReturnedKeys
    : undefined;
}

/** Parser-owned HTML intrinsic identity; component spellings never receive this fact. */
export function isIntrinsicHtmlElement(element: JsxElementModel, name: string): boolean {
  return element.intrinsicTagName === name;
}

/** Compiler-owned mutation binding provenance shared by lowering, emit, and validation. */
export function enhancedMutationFormBinding(
  element: JsxElementModel,
): { end: number; localName: string; start: number } | null {
  if (!isIntrinsicHtmlElement(element, 'form')) return null;
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Mutation form binding attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.name !== 'mutation' || !attribute.expressionBareIdentifierName) continue;
    return {
      end: attribute.end,
      localName: attribute.expressionBareIdentifierName,
      start: attribute.start,
    };
  }

  const spreads = compilerSnapshotDenseArray(
    element.spreadAttributes,
    'Mutation form binding spread attributes',
  );
  for (let index = 0; index < spreads.length; index += 1) {
    const spread = spreads[index]!;
    if (!isMutationFormAttributesSpread(spread)) continue;
    const localName = spread.expressionCallArgumentBareIdentifierName;
    if (localName === undefined) continue;
    return {
      end: spread.end,
      localName,
      start: spread.start,
    };
  }
  return null;
}
