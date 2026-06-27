/** @jsxImportSource @kovojs/server */
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@kovojs/ui/table';

export interface GalleryPureMarkupDemoState {
  submitted: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. Generated files under
// emitted gallery outputs are compiler artifacts used for verification.
export const GalleryPureMarkupDemo = component({
  state: () => ({ submitted: false }),
  render: (_queries: Record<string, never>, state: GalleryPureMarkupDemoState) => {
    const header = TableHead.definition.render({
      children: TableRow.definition.render({
        children: [
          TableHeaderCell.definition.render({
            children: 'Surface',
          }),
          TableHeaderCell.definition.render({
            children: 'Status',
          }),
        ],
      }),
    });
    const body = TableBody.definition.render({
      children: [
        TableRow.definition.render({
          children: [
            TableCell.definition.render({
              children: 'Card and badge',
            }),
            TableCell.definition.render({
              children: 'compiled',
            }),
          ],
        }),
        TableRow.definition.render({
          children: [
            TableCell.definition.render({
              children: 'Breadcrumb and keyboard hint',
            }),
            TableCell.definition.render({
              children: 'compiled',
            }),
          ],
        }),
      ],
    });

    return (
      <section style="display:grid;gap:1rem" data-gallery-interactive="pure-markup">
        <Card>
          <h3>Release readiness</h3>
          <p>
            <Badge variant="success">Stable</Badge> compiled from semantic TSX using the styled
            route class contract.
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
              style="display:inline-flex;height:2.25rem;align-items:center;justify-content:center;gap:0.5rem;border-radius:0.375rem;border:1px solid var(--ink,#0a0a0a);background:var(--ink,#0a0a0a);padding:0 0.75rem;font-size:0.875rem;font-weight:500;color:var(--bg,#fff);box-shadow:0 1px 2px 0 rgba(0,0,0,0.05)"
              form="gallery-pure-markup-form"
              type="button"
              onClick={() => {
                state.submitted = true;
              }}
            >
              Confirm
            </button>
          </form>
          <output
            style="font-size:0.75rem;color:var(--dim,#6b7280);margin-top:0.25rem;display:block"
            data-demo-state="pure-markup-submit"
          >
            {state.submitted ? 'confirmed' : 'pending'}
          </output>
        </Card>
        {Table.definition.render({ children: [header, body] })}
        <div
          aria-hidden="true"
          style="height:1.5rem;width:100%;border-radius:0.375rem;background:var(--edge,#e5e5e5)"
        />
      </section>
    );
  },
});
