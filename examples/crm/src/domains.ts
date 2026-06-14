import { domain } from '@jiso/server';

// SPEC.md §10.1: domains are the invalidation currency. They live in a leaf
// module so the query and mutation modules can import them without creating an
// eagerly-evaluated cycle. Each maps one-to-one to a jiso({ domain }) table.
export const contact = domain('contact');
export const deal = domain('deal');
export const activity = domain('activity');
