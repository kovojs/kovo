import { component } from '@jiso/core';

export const App = component('app-root', {
  state: () => ({}),
  render: () =>
    '<main class="mx-auto grid min-h-dvh max-w-3xl place-items-center px-6 text-jiso-ink"><h1 class="text-3xl font-semibold tracking-normal text-jiso-accent">Hello from Jiso</h1></main>',
});
