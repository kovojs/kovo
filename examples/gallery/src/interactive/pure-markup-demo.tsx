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
import { Table } from '@kovojs/ui/table';

export interface GalleryPureMarkupDemoState {
  submitted: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. Generated files under
// src/generated/interactive are compiler artifacts used for gallery verification.
export const GalleryPureMarkupDemo = component({
  state: () => ({ submitted: false }),
  render: (_queries: Record<string, never>, state: GalleryPureMarkupDemoState) => (
    <section style="display:grid;gap:1rem" data-gallery-interactive="pure-markup">
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
            style="display:inline-flex;height:2.25rem;align-items:center;justify-content:center;gap:0.5rem;border-radius:0.375rem;border:1px solid #0a0a0a;background:#0a0a0a;padding:0 0.75rem;font-size:0.875rem;font-weight:500;color:#fff;box-shadow:0 1px 2px 0 rgba(0,0,0,0.05)"
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
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="pure-markup-submit"
        >
          {state.submitted ? 'confirmed' : 'pending'}
        </output>
      </Card>
      <Table>
        <thead style="border-bottom:1px solid #e5e5e5;background:#fafafa">
          <tr style="border-bottom:1px solid #e5e5e5">
            <th
              style="height:2.5rem;padding:0 0.75rem;text-align:left;vertical-align:middle;font-weight:500;color:#404040"
              scope="col"
            >
              Surface
            </th>
            <th
              style="height:2.5rem;padding:0 0.75rem;text-align:left;vertical-align:middle;font-weight:500;color:#404040"
              scope="col"
            >
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #e5e5e5">
            <td style="padding:0.75rem;vertical-align:middle;color:#0a0a0a">Card and badge</td>
            <td style="padding:0.75rem;vertical-align:middle;color:#0a0a0a">compiled</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e5e5">
            <td style="padding:0.75rem;vertical-align:middle;color:#0a0a0a">
              Breadcrumb and keyboard hint
            </td>
            <td style="padding:0.75rem;vertical-align:middle;color:#0a0a0a">compiled</td>
          </tr>
        </tbody>
      </Table>
      <div
        aria-hidden="true"
        style="height:1.5rem;width:100%;border-radius:0.375rem;background:#e5e5e5"
      />
    </section>
  ),
});
