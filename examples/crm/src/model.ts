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

export const CRM_DEMO_USER_ID = 'u1';
export const CRM_STAGES = ['lead', 'qualified', 'open', 'proposal', 'won', 'lost'] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export interface AddContactInput {
  email: string;
  id: string;
  name: string;
}

export interface CreateDealInput {
  amount: number;
  contactId: string;
  id: string;
  stage: CrmStage;
}

export interface MoveDealInput {
  dealId: string;
  stage: CrmStage;
}

export interface CloseDealInput {
  dealId: string;
}
