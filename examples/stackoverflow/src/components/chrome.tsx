/** @jsxImportSource @kovojs/server */

// Shared page chrome for the Stack Overflow example UI. The app-shell wraps each
// page() return in the document <html>/<head> (with the stylesheet), so these
// helpers render the <body> contents: a top bar plus a centered main column.

export function score(value: number): string {
  return (
    <span class="flex w-12 shrink-0 flex-col items-center text-slate-500">
      <span class="text-xs leading-none">&#9650;</span>
      <span class="text-base font-semibold tabular-nums text-slate-700">{value}</span>
      <span class="text-[10px] uppercase tracking-wide">votes</span>
    </span>
  );
}

// SPEC.md §9.5 / KV229: an exportable upvote island. A static export's documents
// cannot reference a server `/_m/*` endpoint, so this is NOT an enhance form — it
// is an `on:click` handler (browser-backend.ts#vote) that runs the real voteUp
// mutation against the in-browser PGlite and morphs the re-rendered region back
// in. `data-question-id` carries the vote target to the handler.
const VOTE_HANDLER = '/assets/browser-backend.js#vote';

export function voteButton(questionId: string, value: number): string {
  return (
    <button
      type="button"
      on:click={VOTE_HANDLER}
      data-question-id={questionId}
      aria-label="Upvote"
      class="flex w-12 shrink-0 flex-col items-center rounded-md py-1 text-slate-500 hover:bg-orange-50 hover:text-orange-600"
    >
      <span class="text-xs leading-none">&#9650;</span>
      <span class="text-base font-semibold tabular-nums text-slate-700">{value}</span>
      <span class="text-[10px] uppercase tracking-wide">votes</span>
    </button>
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
