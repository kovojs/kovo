import { form, type FormInput } from '@kovojs/core';

// Typed form references shared by mutations and optimistic patches.

export const addContactForm = form('addContact');
export const createDealForm = form('createDeal');
export const moveDealForm = form('moveDeal');
export const closeDealForm = form('closeDeal');

export type AddContactInput = FormInput<typeof addContactForm>;
export type CreateDealInput = FormInput<typeof createDealForm>;
export type MoveDealInput = FormInput<typeof moveDealForm>;
export type CloseDealInput = FormInput<typeof closeDealForm>;
