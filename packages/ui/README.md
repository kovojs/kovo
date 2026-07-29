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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kovojs/ui/card';

export function SettingsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Change the preferences for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="submit">Save changes</Button>
      </CardContent>
      <CardFooter>Your changes apply immediately.</CardFooter>
    </Card>
  );
}
```

## Reference

- API: `/api/ui/`
- Guides: `/guides/components/`, `/guides/styling/`
