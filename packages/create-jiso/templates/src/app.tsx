/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

export const App = component('app-root', {
  state: () => ({ clicks: 0 }),
  render: () => (
    <main
      class="mx-auto grid min-h-dvh max-w-3xl place-items-center px-6 text-jiso-ink"
      fw-c="app-root"
      fw-state='{"clicks":0}'
    >
      <section class="grid gap-5">
        <p class="text-sm font-medium uppercase text-jiso-muted">Routed by the app shell</p>
        <h1 class="text-3xl font-semibold tracking-normal text-jiso-accent">Hello from Jiso</h1>
        <p class="max-w-xl text-base leading-7">
          This page is declared as a Jiso route and served by the same request handler used for
          static export.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 font-medium text-emerald-700"
            data-p-message="starter"
            on:click="/c/starter.client.js?v=starter-r7#Starter$announce"
            type="button"
          >
            Try interaction
          </button>
          <output class="text-sm text-jiso-muted" id="starter-status">
            Ready for first interaction.
          </output>
        </div>
      </section>
    </main>
  ),
});
