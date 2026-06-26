# @kovojs/ui

Styled Kovo server components built on `@kovojs/headless-ui`, `@kovojs/style`,
and native JSX output. Components can be imported from versioned package subpaths
or copied into an app through the registry workflow.

```sh
pnpm add @kovojs/ui @kovojs/style @kovojs/headless-ui
```

```tsx
/** @jsxImportSource @kovojs/server */
import { Button } from '@kovojs/ui/button';
import { Card, CardBody, CardHeader } from '@kovojs/ui/card';

export function SettingsCard() {
  return (
    <Card>
      <CardHeader>Settings</CardHeader>
      <CardBody>
        <Button type="submit">Save changes</Button>
      </CardBody>
    </Card>
  );
}
```

## Reference

- API: `/api/ui/`
- Guides: `/guides/components/`, `/guides/styling/`
