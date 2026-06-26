---
title: Render component trees
description: Render CMS or model-authored rich text through a closed set of approved Kovo components.
order: 4.85
---

# Render component trees

Your product description or assistant answer needs a real callout, card, or chart inside rich text.
Use a render tree when the content shape is data but the components it may call are pre-approved by
your app.

```tsx
import { component } from '@kovojs/core';
import { parseComponentXml, renderRegistry, renderTree, s } from '@kovojs/server';

const Callout = component({
  render: ({ tone = 'info' }, _state, { children }) => <aside data-tone={tone}>{children}</aside>,
});
const registry = renderRegistry({
  'kovo-callout': { component: Callout, props: s.object({ tone: s.string().optional() }) },
});
export const html = await renderTree(
  registry,
  parseComponentXml('Check <kovo-callout tone="warn">stock</kovo-callout>.'),
);
```

The registry is the boundary. A tag that is not in `renderRegistry(...)` can never dispatch to a
component. The XML string becomes a plain AST first; `renderTree(...)` walks that AST server-side,
escapes text, validates attributes, and renders only registered components.

## Register allowed components

Give model/CMS tags boring names that are not ordinary HTML, then pair each tag with a component and
the props schema it accepts:

```tsx
import { component } from '@kovojs/core';
import { renderRegistry, s } from '@kovojs/server';

const ProductBadge = component({
  render: ({ sku, label }: { sku: string; label: string }) => (
    <a href={`/products/${sku}`} data-product-badge>
      {label}
    </a>
  ),
});

export const marketingRegistry = renderRegistry({
  'kovo-product': {
    component: ProductBadge,
    props: s.object({ sku: s.string(), label: s.string() }),
  },
});
```

Attributes arrive as decoded strings from XML. The schema is where you coerce, default, or reject
them. Without a schema, attributes pass through as strings, but they still go through JSX attribute
escaping and URL-scheme checks when the component emits HTML.

## Parse before storage when you can

`parseComponentXml(...)` is pure, so you can validate CMS input before publishing it:

```ts
import { ComponentXmlError, parseComponentXml, type ComponentNode } from '@kovojs/server';

export function parsePublishedBody(source: string): ComponentNode[] {
  try {
    return parseComponentXml(source);
  } catch (error) {
    if (error instanceof ComponentXmlError)
      throw new Error(`Body is not well-formed XML: ${error.message}`);
    throw error;
  }
}
```

Store the source string or the parsed AST, depending on your authoring workflow. The important part:
malformed markup is rejected before it becomes a page-rendering surprise.

## Render at the sink

Render the parsed tree where you would otherwise render rich text:

```tsx
import {
  renderTree,
  safeRichHtml,
  type ComponentNode,
  type ComponentRegistry,
} from '@kovojs/server';

declare const marketingRegistry: ComponentRegistry;
declare function parsePublishedBody(body: string): ComponentNode[];

export async function ProductDescription({ body }: { body: string }) {
  const html = await renderTree(marketingRegistry, parsePublishedBody(body), {
    unknownTag: 'text',
  });
  return (
    <section>
      {safeRichHtml(html, { reason: 'renderTree escapes text and owns component dispatch' })}
    </section>
  );
}
```

`unknownTag: 'text'` drops an unknown wrapper and keeps its children. Use `unknownTag: 'drop'` when
unknown tags should remove the whole subtree.

## Know the failure posture

Render trees fail soft during rendering:

- Unknown tags render as children-only text by default, or drop entirely with `unknownTag: 'drop'`.
- Invalid optional attributes are stripped and the component renders with schema defaults.
- Missing required attributes make that element fall back to the unknown-tag posture.
- Text nodes are escaped by the walker before child HTML is composed into the registered component.

This is for bounded rich text, not arbitrary HTML. If the author needs raw markup, use
`safeRichHtml(...)` with an explicit sanitizer and audit reason instead.

## Next

- [Components](/guides/components/) - author server components that can be registered.
- [Security & authorization](/guides/security/) - source/sink review for HTML and trusted output.
- [Wire protocol](/guides/wire-protocol/) - inspect the fragment/query vocabulary after rendering.
- [Server API reference](/api/server/) - generated reference for `renderTree`, `renderRegistry`, and
  `parseComponentXml`.

<details>
<summary>Spec & diagnostics</summary>

Registry-bounded dynamic rendering, the closed registry boundary, server-side one-shot rendering,
well-formed XML parsing, unknown-tag posture, attribute validation, and text escaping are specified
by SPEC §4.10. Component composition and server-rendered child posture come from SPEC §4.5. Output
safety and trusted HTML boundaries come from SPEC §4.8. Schema validation follows SPEC §6.3.

</details>
