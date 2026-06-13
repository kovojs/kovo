// SPEC.md section 6.1.1: first-party primitive packages publish a
// package-prefix vocabulary, and `fw explain component` must print provenance
// for prefixed component targets.
export const galleryFwExplainGraph = Object.freeze({
  components: [
    {
      attributeMerges: [
        {
          attr: 'aria-expanded',
          decision: 'author-wins',
          diagnostics: ['FW232'],
          element: 'button',
          rule: 'aria-author-override',
        },
      ],
      fragments: ['jiso-dialog'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'click',
          exportName: 'JisoDialog$trigger_click',
          params: [],
          ref: '/c/examples/gallery/dialog.client.js#JisoDialog$trigger_click',
          substitution: 'dialog-show-modal',
        },
        {
          captures: ['ctx'],
          event: 'cancel',
          exportName: 'JisoDialog$content_cancel',
          params: [],
          ref: '/c/examples/gallery/dialog.client.js#JisoDialog$content_cancel',
        },
      ],
      name: 'JisoDialog',
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
      fragments: ['jiso-tabs'],
      handlers: [
        {
          captures: ['ctx', 'element-params'],
          event: 'click',
          exportName: 'JisoTabs$trigger_click',
          params: ['value'],
          ref: '/c/examples/gallery/tabs.client.js#JisoTabs$trigger_click',
        },
        {
          captures: ['ctx'],
          event: 'keydown',
          exportName: 'JisoTabs$list_keydown',
          params: [],
          ref: '/c/examples/gallery/tabs.client.js#JisoTabs$list_keydown',
        },
      ],
      name: 'JisoTabs',
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
      fragments: ['jiso-dropdown-menu'],
      handlers: [
        {
          captures: ['ctx'],
          event: 'click',
          exportName: 'JisoDropdownMenu$trigger_click',
          params: [],
          ref: '/c/examples/gallery/dropdown-menu.client.js#JisoDropdownMenu$trigger_click',
        },
        {
          captures: ['ctx', 'element-params'],
          event: 'keydown',
          exportName: 'JisoDropdownMenu$content_keydown',
          params: ['value'],
          ref: '/c/examples/gallery/dropdown-menu.client.js#JisoDropdownMenu$content_keydown',
        },
      ],
      name: 'JisoDropdownMenu',
      queries: [],
    },
  ],
  packageComponentPrefixes: [
    {
      effectivePrefix: 'jiso-',
      packageName: '@jiso/headless-ui',
      prefix: 'jiso-',
    },
  ],
});

export const galleryFwExplainCases = Object.freeze([
  {
    expectedHandlers: ['click', 'cancel'],
    expectedMergeAttrs: ['aria-expanded'],
    expectedSubject: 'COMPONENT JisoDialog',
    target: 'jiso-dialog',
    title: 'H1 dialog package component',
  },
  {
    expectedHandlers: ['click', 'keydown'],
    expectedMergeAttrs: ['data-state'],
    expectedSubject: 'COMPONENT JisoTabs',
    target: 'jiso-tabs',
    title: 'H2 tabs package component',
  },
  {
    expectedHandlers: ['click', 'keydown'],
    expectedMergeAttrs: ['data-highlighted'],
    expectedSubject: 'COMPONENT JisoDropdownMenu',
    target: 'jiso-dropdown-menu',
    title: 'H3 dropdown-menu package component',
  },
]);
