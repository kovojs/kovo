import type { CrmDb } from './db.js';
import { activities, contacts, deals } from './schema.js';

// Realistic demo book layered on top of the minimal createCrmDb() seed (which
// the commuting tests depend on, so it stays untouched — SPEC.md §10.5). This
// enriches ONLY the app-shell / serve surface: a fuller contact book, deals
// spread across the pipeline stages, and a few activities, so the UI reads like
// a real sales CRM rather than a two-row fixture. Ids never collide with the
// base seed's c1/c2/d1/d2.

const DEMO_CONTACTS = [
  { id: 'c3', name: 'Margaret Hamilton', email: 'margaret@apollo.example.com', ownerId: 'u1', dealCount: 2 },
  { id: 'c4', name: 'Katherine Johnson', email: 'katherine@apollo.example.com', ownerId: 'u1', dealCount: 1 },
  { id: 'c5', name: 'Alan Turing', email: 'alan@bletchley.example.com', ownerId: 'u2', dealCount: 2 },
  { id: 'c6', name: 'Barbara Liskov', email: 'barbara@mit.example.com', ownerId: 'u2', dealCount: 1 },
  { id: 'c7', name: 'Donald Knuth', email: 'don@stanford.example.com', ownerId: 'u1', dealCount: 1 },
  { id: 'c8', name: 'Radia Perlman', email: 'radia@spanningtree.example.com', ownerId: 'u2', dealCount: 1 },
];

const DEMO_DEALS = [
  { id: 'd3', contactId: 'c3', stage: 'open', amount: 8000, ownerId: 'u1' },
  { id: 'd4', contactId: 'c3', stage: 'proposal', amount: 15000, ownerId: 'u1' },
  { id: 'd5', contactId: 'c4', stage: 'qualified', amount: 6000, ownerId: 'u1' },
  { id: 'd6', contactId: 'c5', stage: 'open', amount: 9500, ownerId: 'u2' },
  { id: 'd7', contactId: 'c5', stage: 'won', amount: 22000, ownerId: 'u2' },
  { id: 'd8', contactId: 'c6', stage: 'lead', amount: 3000, ownerId: 'u2' },
  { id: 'd9', contactId: 'c7', stage: 'lost', amount: 4000, ownerId: 'u1' },
  { id: 'd10', contactId: 'c8', stage: 'open', amount: 11000, ownerId: 'u2' },
];

const DEMO_ACTIVITIES = [
  { dealId: 'd1', kind: 'call', note: 'Intro call — interested in the enterprise plan.' },
  { dealId: 'd3', kind: 'email', note: 'Sent the pricing deck and security overview.' },
  { dealId: 'd4', kind: 'note', note: 'Proposal is under legal review on their side.' },
  { dealId: 'd6', kind: 'call', note: 'Booked a product demo for next Tuesday.' },
  { dealId: 'd7', kind: 'note', note: 'Closed-won — annual contract signed.' },
];

/** Insert the richer demo dataset into a freshly-created CRM db. */
export async function seedCrmDemo(db: CrmDb): Promise<void> {
  await db.insert(contacts).values(DEMO_CONTACTS);
  await db.insert(deals).values(DEMO_DEALS);
  await db.insert(activities).values(DEMO_ACTIVITIES);
}
