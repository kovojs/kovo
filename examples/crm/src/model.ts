import { form, type FormInput } from '@kovojs/core';
import { domain } from '@kovojs/server';

// Small shared authoring facts for the CRM demo: invalidation domains plus the
// typed form handles reused by components, mutations, and optimistic patches.
export const contact = domain('contact');
export const deal = domain('deal');
export const activity = domain('activity');

export const addContactForm = form('addContact');
export const createDealForm = form('createDeal');
export const moveDealForm = form('moveDeal');
export const closeDealForm = form('closeDeal');

export type AddContactInput = FormInput<typeof addContactForm>;
export type CreateDealInput = FormInput<typeof createDealForm>;
export type MoveDealInput = FormInput<typeof moveDealForm>;
export type CloseDealInput = FormInput<typeof closeDealForm>;
