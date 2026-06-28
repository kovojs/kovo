import { domain } from '@kovojs/server';

// Small shared authoring facts for the CRM demo: invalidation domains plus the
// typed input shapes reused by mutations and optimistic patches.
export const contact = domain();
export const deal = domain();
export const activity = domain();

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
