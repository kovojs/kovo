# @kovojs/headless-ui

Headless behavior primitives for Kovo UI components. The package emits ARIA
attributes, data attributes, state shapes, and event handlers that can be styled
or copied into an app without shipping a client-side component framework.

```sh
pnpm add @kovojs/headless-ui
```

```ts
import {
  dialogContentAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';

const state = {
  contentId: 'settings-panel',
  titleId: 'settings-title',
  open: false,
};

const triggerAttrs = dialogTriggerAttributes(state);
const contentAttrs = dialogContentAttributes(state);
```

## Reference

- API: `/api/headless-ui/`
- Guide: `/guides/components/`
