/** @jsxImportSource @kovojs/server */
import { voteUpMutation } from '../mutations.js';

// Shared page chrome for the Stack Overflow example UI. The app-shell wraps each
// page() return in the document <html>/<head> (with the stylesheet), so these
// helpers render the <body> contents: a top bar plus a centered main column.

// SPEC.md §6.3: postQuestion / postAnswer use text primary keys, so each rendered
// composer mints a unique id. The app-shell renders server-side (Node), where
// crypto.randomUUID is available; a fresh fragment re-render yields a new id, so
// sequential posts never collide.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// SPEC.md §6.3: a no-JS upvote form. It POSTs to the `voteUp` mutation endpoint;
// served by the Node app, the inline loader (§9.1) intercepts the submit, fetches
// the fragment wire, and morphs the re-rendered region with the server-truth
// score. The hidden `id` satisfies the mutation input schema (the votes row uses
// a serial key, so the handler ignores it); `userId` is the demo viewer.
export function voteButton(questionId: string, value: number): string {
  return (
    <form enhance mutation={voteUpMutation} class="w-12 shrink-0">
      <input type="hidden" name="id" value={`vote-${questionId}`} />
      <input type="hidden" name="targetId" value={questionId} />
      <input type="hidden" name="userId" value="demo-viewer" />
      <button
        type="submit"
        aria-label="Upvote"
        class="flex w-full flex-col items-center rounded-md py-1 text-slate-500 hover:bg-orange-50 hover:text-orange-600"
      >
        <span class="text-xs leading-none">&#9650;</span>
        <span class="text-base font-semibold tabular-nums text-slate-700">{value}</span>
        <span class="text-[10px] uppercase tracking-wide">votes</span>
      </button>
    </form>
  );
}

export function renderSoShell(body: string): string {
  return (
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span class="grid h-7 w-7 place-items-center rounded-md bg-orange-500 text-xs font-bold text-white">
              DO
            </span>
            DevOverflow
          </a>
          <nav class="text-sm">
            <a
              href="/"
              class="rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100"
            >
              Questions
            </a>
          </nav>
        </div>
      </header>
      <main class="mx-auto max-w-3xl px-6 py-8">{body}</main>
    </div>
  );
}
