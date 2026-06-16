// SPEC.md section 6.1.1: first-party primitive packages publish a
// package-prefix vocabulary, and `kovo explain component` must print provenance
// for prefixed component targets.
export const galleryKovoExplainGraph = Object.freeze({
  components: [
    {
      attributeMerges: [
        {
          attr: 'aria-expanded',
          decision: 'author-wins',
          diagnostics: ['KV232'],
          element: 'button',
          rule: 'aria-author-override',
        },
      ],
      fragments: ['kovo-dialog'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'click',
          exportName: 'KovoDialog$trigger_click',
          params: [],
          ref: '/c/examples/gallery/dialog.client.js#KovoDialog$trigger_click',
          substitution: 'dialog-show-modal',
        },
        {
          captures: ['ctx'],
          event: 'cancel',
          exportName: 'KovoDialog$content_cancel',
          params: [],
          ref: '/c/examples/gallery/dialog.client.js#KovoDialog$content_cancel',
        },
      ],
      name: 'KovoDialog',
      platformSubstitutions: [
        {
          action: 'show-modal',
          event: 'click',
          kind: 'dialog',
          tag: 'button',
          target: 'gallery-dialog-content',
        },
      ],
      queries: [],
    },
    {
      attributeMerges: [
        {
          attr: 'data-state',
          decision: 'primitive-wins',
          diagnostics: [],
          element: 'button',
          rule: 'state-attribute',
        },
      ],
      fragments: ['kovo-tabs'],
      handlers: [
        {
          captures: ['ctx', 'element-params'],
          event: 'click',
          exportName: 'KovoTabs$trigger_click',
          params: ['value'],
          ref: '/c/examples/gallery/tabs.client.js#KovoTabs$trigger_click',
        },
        {
          captures: ['ctx'],
          event: 'keydown',
          exportName: 'KovoTabs$list_keydown',
          params: [],
          ref: '/c/examples/gallery/tabs.client.js#KovoTabs$list_keydown',
        },
      ],
      name: 'KovoTabs',
      queries: [],
    },
    {
      attributeMerges: [
        {
          attr: 'data-highlighted',
          decision: 'primitive-wins',
          diagnostics: [],
          element: 'button',
          rule: 'state-attribute',
        },
      ],
      fragments: ['kovo-dropdown-menu'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'click',
          exportName: 'KovoDropdownMenu$trigger_click',
          params: [],
          ref: '/c/examples/gallery/dropdown-menu.client.js#KovoDropdownMenu$trigger_click',
        },
        {
          captures: ['ctx', 'element-params'],
          event: 'keydown',
          exportName: 'KovoDropdownMenu$content_keydown',
          params: ['value'],
          ref: '/c/examples/gallery/dropdown-menu.client.js#KovoDropdownMenu$content_keydown',
        },
      ],
      name: 'KovoDropdownMenu',
      queries: [],
    },
    {
      attributeMerges: [
        {
          attr: 'data-state',
          decision: 'primitive-wins',
          diagnostics: [],
          element: 'a',
          rule: 'state-attribute',
        },
        {
          attr: 'aria-expanded',
          decision: 'author-wins',
          diagnostics: ['KV232'],
          element: 'a',
          rule: 'aria-author-override',
        },
      ],
      fragments: ['kovo-hover-card'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'focus',
          exportName: 'KovoHoverCard$trigger_focus',
          params: [],
          ref: '/c/examples/gallery/hover-card.client.js#KovoHoverCard$trigger_focus',
        },
        {
          captures: ['ctx'],
          event: 'pointerenter',
          exportName: 'KovoHoverCard$trigger_pointerenter',
          params: [],
          ref: '/c/examples/gallery/hover-card.client.js#KovoHoverCard$trigger_pointerenter',
        },
        {
          captures: ['ctx'],
          event: 'keydown',
          exportName: 'KovoHoverCard$trigger_keydown',
          params: [],
          ref: '/c/examples/gallery/hover-card.client.js#KovoHoverCard$trigger_keydown',
        },
      ],
      name: 'KovoHoverCard',
      queries: [],
    },
    {
      attributeMerges: [
        {
          attr: 'data-state',
          decision: 'primitive-wins',
          diagnostics: [],
          element: 'button',
          rule: 'state-attribute',
        },
        {
          attr: 'aria-describedby',
          decision: 'primitive-wins',
          diagnostics: [],
          element: 'button',
          rule: 'idref-state',
        },
      ],
      fragments: ['kovo-tooltip'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'focus',
          exportName: 'KovoTooltip$trigger_focus',
          params: [],
          ref: '/c/examples/gallery/tooltip.client.js#KovoTooltip$trigger_focus',
        },
        {
          captures: ['ctx'],
          event: 'pointerenter',
          exportName: 'KovoTooltip$trigger_pointerenter',
          params: [],
          ref: '/c/examples/gallery/tooltip.client.js#KovoTooltip$trigger_pointerenter',
        },
        {
          captures: ['ctx'],
          event: 'keydown',
          exportName: 'KovoTooltip$trigger_keydown',
          params: [],
          ref: '/c/examples/gallery/tooltip.client.js#KovoTooltip$trigger_keydown',
        },
      ],
      name: 'KovoTooltip',
      queries: [],
    },
  ],
  packageComponentPrefixes: [
    {
      effectivePrefix: 'kovo-',
      packageName: '@kovojs/headless-ui',
      prefix: 'kovo-',
    },
  ],
});

export const galleryKovoExplainCases = Object.freeze([
  {
    expectedHandlers: ['click', 'cancel'],
    expectedMergeAttrs: ['aria-expanded'],
    expectedSubject: 'COMPONENT KovoDialog',
    target: 'kovo-dialog',
    title: 'H1 dialog package component',
  },
  {
    expectedHandlers: ['click', 'keydown'],
    expectedMergeAttrs: ['data-state'],
    expectedSubject: 'COMPONENT KovoTabs',
    target: 'kovo-tabs',
    title: 'H2 tabs package component',
  },
  {
    expectedHandlers: ['click', 'keydown'],
    expectedMergeAttrs: ['data-highlighted'],
    expectedSubject: 'COMPONENT KovoDropdownMenu',
    target: 'kovo-dropdown-menu',
    title: 'H3 dropdown-menu package component',
  },
  {
    expectedHandlers: ['focus', 'pointerenter', 'keydown'],
    expectedMergeAttrs: ['data-state', 'aria-expanded'],
    expectedSubject: 'COMPONENT KovoHoverCard',
    target: 'kovo-hover-card',
    title: 'H1 hover-card overlay package component',
  },
  {
    expectedHandlers: ['focus', 'pointerenter', 'keydown'],
    expectedMergeAttrs: ['data-state', 'aria-describedby'],
    expectedSubject: 'COMPONENT KovoTooltip',
    target: 'kovo-tooltip',
    title: 'H1 tooltip overlay package component',
  },
]);
