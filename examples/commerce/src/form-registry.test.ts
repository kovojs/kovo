import { describe, expect, it } from 'vitest';

import {
  form,
  type Form,
  type FormFailure,
  type FormInput,
  type FormValidationFailure,
} from '@kovojs/core';

import type { AddToCartInput } from './app.js';
import './generated/touch-graph.js';

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2
    ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
      ? true
      : false
    : false;

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Assert<T extends true> = T;

describe('generated mutation registry', () => {
  it('infers cart/add form input and failure from the generated MutationRegistry', () => {
    const inferredAddToCartForm = form('cart/add');
    type ExplicitAddToCartForm = Form<
      'cart/add',
      AddToCartInput,
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >;

    expect(inferredAddToCartForm.key).toBe('cart/add');

    type InferredInput = FormInput<typeof inferredAddToCartForm>;
    type InferredFailure = FormFailure<typeof inferredAddToCartForm>;
    type OutOfStockFailure = Extract<InferredFailure, { code: 'OUT_OF_STOCK' }>;
    type OutOfStockPayload = OutOfStockFailure extends { payload: infer Payload } ? Payload : never;
    type ExpectedFailure =
      | { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
      | FormValidationFailure;

    type _InputMatchesExplicit = Assert<Extends<InferredInput, FormInput<ExplicitAddToCartForm>>>;
    type _ExplicitMatchesInput = Assert<Extends<FormInput<ExplicitAddToCartForm>, InferredInput>>;
    type _ProductIdStaysSchemaBacked = Assert<Equal<InferredInput['productId'], string>>;
    type _QuantityStaysSchemaBacked = Assert<Equal<InferredInput['quantity'], number>>;
    type _FailureStaysSchemaBacked = Assert<Extends<InferredFailure, ExpectedFailure>>;
    type _ExpectedFailureIsAccepted = Assert<Extends<ExpectedFailure, InferredFailure>>;
    type _OutOfStockPayloadStaysSchemaBacked = Assert<
      Extends<OutOfStockPayload, { availableQuantity: number }>
    >;
    type _ExpectedPayloadIsAccepted = Assert<
      Extends<{ availableQuantity: number }, OutOfStockPayload>
    >;
    type _ValidationFailureIsIncluded = Assert<
      Equal<Extract<InferredFailure, FormValidationFailure>, FormValidationFailure>
    >;
  });
});
