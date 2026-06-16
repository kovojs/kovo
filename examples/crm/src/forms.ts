import { form } from '@kovojs/core';

// SPEC.md §6.3 / §10.4: typed form references. The input and the invalidated
// query set come from the mutation + query registries declared by the generated
// touch-graph module, so `OptimisticFor<typeof form>` is exhaustiveness-checked
// against exactly the queries each mutation invalidates. Inputs are `type`
// aliases (object types pick up the JsonValue index signature `Form` requires;
// an `interface` would not).

export type AddContactInput = {
  id: string;
  name: string;
  email: string;
  ownerId: string;
};

export type CreateDealInput = {
  id: string;
  contactId: string;
  stage: string;
  amount: number;
  ownerId: string;
};

export type MoveDealInput = {
  dealId: string;
  stage: string;
};

export type CloseDealInput = {
  dealId: string;
};

export const addContactForm = form<'addContact', AddContactInput>('addContact');
export const createDealForm = form<'createDeal', CreateDealInput>('createDeal');
export const moveDealForm = form<'moveDeal', MoveDealInput>('moveDeal');
export const closeDealForm = form<'closeDeal', CloseDealInput>('closeDeal');
