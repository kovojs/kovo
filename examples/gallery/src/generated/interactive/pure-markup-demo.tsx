// @kovojs-ir - lowered from examples/gallery/src/interactive/pure-markup-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryPureMarkupDemo$output_text_derive = derive(['state'], (state: any) =>
  state.submitted ? 'confirmed' : 'pending',
);

import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from '@kovojs/ui/breadcrumb';
import { Card } from '@kovojs/ui/card';
import { Kbd } from '@kovojs/ui/kbd';
import { Table } from '@kovojs/ui/table';

export interface GalleryPureMarkupDemoState {
  submitted: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. Generated files under
// src/generated/interactive are compiler artifacts used for gallery verification.
export const GalleryPureMarkupDemo = component({
  state: () => ({ submitted: false }),
  render: (_queries: Record<string, never>, state: GalleryPureMarkupDemoState) => (
    <section
      class="grid gap-4"
      data-gallery-interactive="pure-markup"
      kovo-c="gallery-pure-markup-demo"
      kovo-state='{"submitted":false}'
    >
      <Card>
        <h3>Release readiness</h3>
        <p>
          <Badge variant="success">Stable</Badge> compiled from semantic TSX using the styled route
          class contract.
        </p>
        <Breadcrumb label="Release trail">
          <BreadcrumbItem>
            <BreadcrumbLink href="/gallery/components/button/">Button</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink current>Table</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <p>
          Press <Kbd>Enter</Kbd> to confirm the generated handler path.
        </p>
        <form id="gallery-pure-markup-form">
          <button
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-neutral-950 bg-neutral-950 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50"
            form="gallery-pure-markup-form"
            type="button"
            on:click="/c/__v/c4684e50/examples/gallery/src/generated/interactive/pure-markup-demo.client.js#GalleryPureMarkupDemo$button_click"
          >
            Confirm
          </button>
        </form>
        <output
          data-demo-state="pure-markup-submit"
          data-bind="/c/__v/c4684e50/examples/gallery/src/generated/interactive/pure-markup-demo.client.js#GalleryPureMarkupDemo$output_text_derive"
        >
          {state.submitted ? 'confirmed' : 'pending'}
        </output>
      </Card>
      <Table>
        <thead class="border-b border-neutral-200 bg-neutral-50">
          <tr class="border-b border-neutral-200 transition-colors hover:bg-neutral-50">
            <th class="h-10 px-3 text-left align-middle font-medium text-neutral-700" scope="col">
              Surface
            </th>
            <th class="h-10 px-3 text-left align-middle font-medium text-neutral-700" scope="col">
              Status
            </th>
          </tr>
        </thead>
        <tbody class="[&_tr:last-child]:border-0">
          <tr class="border-b border-neutral-200 transition-colors hover:bg-neutral-50">
            <td class="p-3 align-middle text-neutral-950">Card and badge</td>
            <td class="p-3 align-middle text-neutral-950">compiled</td>
          </tr>
          <tr class="border-b border-neutral-200 transition-colors hover:bg-neutral-50">
            <td class="p-3 align-middle text-neutral-950">Breadcrumb and keyboard hint</td>
            <td class="p-3 align-middle text-neutral-950">compiled</td>
          </tr>
        </tbody>
      </Table>
      <div aria-hidden="true" class="h-6 w-full animate-pulse rounded-md bg-neutral-200" />
    </section>
  ),
});
GalleryPureMarkupDemo.name = 'generated/interactive/pure-markup-demo/gallery-pure-markup-demo';
