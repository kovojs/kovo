import type {
  ContactDealCountResult,
  ContactListResult,
  DealListResult,
  OpenDealsResult,
  PipelineByStageResult,
} from '../queries.js';

export const crmTouchGraph = {
  "addContact": {
    "reads": [
      {
        "domain": "contact",
        "keys": null,
        "site": "examples/crm/src/mutations.ts:59",
        "source": "select",
        "via": "contacts"
      }
    ],
    "touches": [
      {
        "domain": "contact",
        "keys": null,
        "site": "examples/crm/src/mutations.ts:64",
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
        "site": "examples/crm/src/mutations.ts:92",
        "via": "contacts"
      },
      {
        "domain": "deal",
        "keys": null,
        "site": "examples/crm/src/mutations.ts:91",
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
        "site": "examples/crm/src/mutations.ts:139",
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
        "site": "examples/crm/src/mutations.ts:189",
        "via": "deals"
      }
    ],
    "unresolved": []
  }
} as const;

export const crmQueryDomains = [
  {
    "domains": ["contact"],
    "query": "contactList"
  },
  {
    "domains": ["deal"],
    "query": "dealList"
  },
  {
    "domains": ["deal"],
    "query": "contactDealCount"
  },
  {
    "domains": ["deal"],
    "query": "openDeals"
  },
  {
    "domains": ["deal"],
    "query": "pipelineByStage"
  }
] as const;

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

  interface MutationRegistry {
    addContact: typeof import('../mutations.js').addContact;
    createDeal: typeof import('../mutations.js').createDeal;
    moveDeal: typeof import('../mutations.js').moveDeal;
    closeDeal: typeof import('../mutations.js').closeDeal;
  }

  interface InvalidationSets extends CrmInvalidationSets {}
}
