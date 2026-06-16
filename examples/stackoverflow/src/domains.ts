import { domain } from '@kovojs/server';

// SPEC.md §10.1: domains are the invalidation currency. They mirror the
// kovo({ domain }) annotations in schema.ts and live in a leaf module so query
// and mutation modules can import them without an app-level cycle.
export const question = domain('question');
export const answer = domain('answer');
export const vote = domain('vote');
