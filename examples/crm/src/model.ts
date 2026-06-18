import { form } from '@kovojs/core';
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

export interface AddContactInput {
  email: string;
  id: string;
  name: string;
  ownerId: string;
}

export interface CreateDealInput {
  amount: number;
  contactId: string;
  id: string;
  ownerId: string;
  stage: string;
}

export interface MoveDealInput {
  dealId: string;
  stage: string;
}

export interface CloseDealInput {
  dealId: string;
}
