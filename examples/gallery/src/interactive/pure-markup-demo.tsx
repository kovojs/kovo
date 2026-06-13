/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

export interface GalleryPureMarkupDemoState {
  submitted: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. Generated files under
// src/generated/interactive are compiler artifacts used for gallery verification.
export const GalleryPureMarkupDemo = component('gallery-pure-markup-demo', {
  state: () => ({ submitted: false }),
  render: (_queries: Record<string, never>, state: GalleryPureMarkupDemoState) => (
    <section class="grid gap-4" data-gallery-interactive="pure-markup">
      <section
        class="rounded-lg border border-neutral-200 bg-white p-4 text-neutral-950 shadow-sm"
        data-card="summary"
      >
        <h3>Release readiness</h3>
        <p>
          <span class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Stable
          </span>{' '}
          compiled from semantic TSX using the styled route class contract.
        </p>
        <nav
          aria-label="Release trail"
          class="flex flex-wrap items-center gap-1.5 text-sm text-neutral-500"
        >
          <ol class="flex flex-wrap items-center gap-1.5">
            <li class="inline-flex items-center gap-1.5">
              <a
                class="font-medium text-neutral-600 transition-colors hover:text-neutral-950"
                href="/components/button"
              >
                Button
              </a>
            </li>
            <li
              aria-hidden="true"
              class="text-neutral-400"
              data-orientation="horizontal"
              role="separator"
            >
              /
            </li>
            <li class="inline-flex items-center gap-1.5">
              <a aria-current="page" class="font-medium text-neutral-950">
                Table
              </a>
            </li>
          </ol>
        </nav>
        <p>
          Press{' '}
          <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[11px] font-medium leading-none text-neutral-700 shadow-sm">
            Enter
          </kbd>{' '}
          to confirm the generated handler path.
        </p>
        <form id="gallery-pure-markup-form">
          <button
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-neutral-950 bg-neutral-950 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50"
            form="gallery-pure-markup-form"
            type="button"
            onClick={() => {
              state.submitted = true;
              const doc = Reflect['get'](globalThis, 'document');
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="pure-markup-submit"]')
                : undefined;

              if (output) output['textContent'] = 'confirmed';
            }}
          >
            Confirm
          </button>
        </form>
        <output data-demo-state="pure-markup-submit">
          {state.submitted ? 'confirmed' : 'pending'}
        </output>
      </section>
      <div class="w-full overflow-x-auto">
        <table
          aria-label="Styled route coverage"
          class="w-full caption-bottom border-collapse text-sm"
        >
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
        </table>
      </div>
      <div aria-hidden="true" class="h-6 w-full animate-pulse rounded-md bg-neutral-200" />
    </section>
  ),
});
