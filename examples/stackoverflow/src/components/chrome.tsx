/** @jsxImportSource @jiso/server */

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
            <a href="/" class="rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100">
              Questions
            </a>
          </nav>
        </div>
      </header>
      <main class="mx-auto max-w-3xl px-6 py-8">{body}</main>
    </div>
  );
}
