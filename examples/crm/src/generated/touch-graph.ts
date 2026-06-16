import type {
  ContactDealCountResult,
  ContactListResult,
  DealListResult,
  OpenDealsResult,
  PipelineByStageResult,
} from '../queries.js';

export const crmTouchGraph = {
  "addContact": {
    "reads": [],
    "touches": [
      {
        "domain": "contact",
        "keys": null,
        "site": "examples/crm/src/mutations.ts:58",
        "via": "contacts"
      }
    ],
    "unresolved": []
  },
  "createDeal": {
    "reads": [],
    "touches": [
      {
        "domain": "contact",
        "keys": "arg:contactId",
        "site": "examples/crm/src/mutations.ts:89",
        "via": "contacts"
      },
      {
        "domain": "deal",
        "keys": null,
        "site": "examples/crm/src/mutations.ts:88",
        "via": "deals"
      }
    ],
    "unresolved": []
  },
  "moveDeal": {
    "reads": [],
    "touches": [
      {
        "domain": "deal",
        "keys": "arg:dealId",
        "site": "examples/crm/src/mutations.ts:147",
        "via": "deals"
      }
    ],
    "unresolved": []
  },
  "closeDeal": {
    "reads": [],
    "touches": [
      {
        "domain": "deal",
        "keys": "arg:dealId",
        "site": "examples/crm/src/mutations.ts:213",
        "via": "deals"
      }
    ],
    "unresolved": []
  }
} as const;

export const crmInvalidationSets = {
  'addContact': [
    { query: 'contactList', domains: ['contact'], keys: null },
  ],
  'closeDeal': [
    { query: 'contactDealCount', domains: ['deal'], keys: null },
    { query: 'dealList', domains: ['deal'], keys: null },
    { query: 'openDeals', domains: ['deal'], keys: null },
    { query: 'pipelineByStage', domains: ['deal'], keys: null },
  ],
  'createDeal': [
    { query: 'contactDealCount', domains: ['deal'], keys: null },
    { query: 'contactList', domains: ['contact'], keys: null },
    { query: 'dealList', domains: ['deal'], keys: null },
    { query: 'openDeals', domains: ['deal'], keys: null },
    { query: 'pipelineByStage', domains: ['deal'], keys: null },
  ],
  'moveDeal': [
    { query: 'contactDealCount', domains: ['deal'], keys: null },
    { query: 'dealList', domains: ['deal'], keys: null },
    { query: 'openDeals', domains: ['deal'], keys: null },
    { query: 'pipelineByStage', domains: ['deal'], keys: null },
  ],
} as const;

export interface CrmInvalidationSets {
  'addContact': 'contactList';
  'closeDeal': 'contactDealCount' | 'dealList' | 'openDeals' | 'pipelineByStage';
  'createDeal': 'contactDealCount' | 'contactList' | 'dealList' | 'openDeals' | 'pipelineByStage';
  'moveDeal': 'contactDealCount' | 'dealList' | 'openDeals' | 'pipelineByStage';
}

declare module '@kovojs/core' {
  interface QueryRegistry {
    contactList: ContactListResult;
    dealList: DealListResult;
    contactDealCount: ContactDealCountResult;
    openDeals: OpenDealsResult;
    pipelineByStage: PipelineByStageResult;
  }

  interface InvalidationSets extends CrmInvalidationSets {}
}
