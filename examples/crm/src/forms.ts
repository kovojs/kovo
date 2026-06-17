import { form, type FormInput } from '@kovojs/core';

// SPEC.md §6.3 / §10.4: typed form references. Input and invalidated-query
// facts come from generated registries, so `OptimisticFor<typeof form>` is
// exhaustiveness-checked without app-authored form generics.

export const addContactForm = form('addContact');
export const createDealForm = form('createDeal');
export const moveDealForm = form('moveDeal');
export const closeDealForm = form('closeDeal');

export type AddContactInput = FormInput<typeof addContactForm>;
export type CreateDealInput = FormInput<typeof createDealForm>;
export type MoveDealInput = FormInput<typeof moveDealForm>;
export type CloseDealInput = FormInput<typeof closeDealForm>;
