import { domain } from '@kovojs/server';

// Domains group the CRM rows that each mutation touches.
export const contact = domain('contact');
export const deal = domain('deal');
export const activity = domain('activity');
