import type { RequestHandler } from '@kovojs/server';

import { buildSoInteractiveApp } from './interactive-app.js';

// SPEC.md §9.5: the in-browser backend + client islands for the Stack Overflow
// static export. A static export ships no server and (SPEC §9.5 / KV229) its
// documents must not reference server `/_m/*` endpoints — they have to degrade as
// exportable client islands. So instead of an `enhance` form that POSTs to a
// server, the upvote button is an `on:click` island: this module (bundled for the
// browser by Vite) stands up the SAME interactive Kovo app over an in-browser
// PGlite database and runs the mutation locally. The request handler is pure Web
// Fetch (no Node), so the fragment bytes are exactly what a Node server would
// return; we then morph the re-rendered region into the page. State lives in WASM
// memory and resets on reload — the right mental model for a sandboxed demo.

let handlerPromise: Promise<RequestHandler> | null = null;

function ensureHandler(): Promise<RequestHandler> {
  if (!handlerPromise) {
    handlerPromise = buildSoInteractiveApp().then((built) => built.handler);
  }
  return handlerPromise;
}

// Run a mutation against the in-browser app and morph its fragment wire into the
// page. The fragment payload re-renders a whole `kovo-fragment-target` host
// (renderQuestionListRegion), so replacing the matching element wholesale is
// sufficient; the inline loader's document-level `on:*` delegation keeps the
// freshly inserted buttons live.
async function runMutation(key: string, input: Record<string, string>): Promise<void> {
  const handler = await ensureHandler();
  const response = await handler(
    new Request(`http://kovo.local/_m/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${input.id ?? ''}-${Date.now()}`,
      },
      body: new URLSearchParams(input),
    }),
  );
  applyFragmentWire(await response.text());
}

const FRAGMENT_PATTERN = /<kovo-fragment\b[^>]*\btarget="([^"]+)"[^>]*>([\s\S]*?)<\/kovo-fragment>/g;

function applyFragmentWire(wire: string): void {
  for (const match of wire.matchAll(FRAGMENT_PATTERN)) {
    const target = match[1];
    const html = match[2];
    if (!target) continue;
    const host =
      document.querySelector(`[kovo-fragment-target="${cssEscape(target)}"]`) ??
      document.getElementById(target) ??
      document.querySelector(`[kovo-c="${cssEscape(target)}"]`);
    if (host) host.outerHTML = html;
  }
}

function cssEscape(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
  return escaper ? escaper(value) : value.replace(/["\\]/g, '\\$&');
}

function eventElement(event: Event): HTMLElement | null {
  const node = (event.currentTarget ?? event.target) as Node | null;
  return node instanceof HTMLElement ? node : null;
}

/**
 * `on:click` island for the upvote button. Reads the target question id from the
 * button's `data-question-id` and runs the real `voteUp` mutation.
 */
export async function vote(event: Event): Promise<void> {
  event.preventDefault?.();
  const button = eventElement(event)?.closest<HTMLElement>('[data-question-id]');
  const targetId = button?.getAttribute('data-question-id');
  if (!targetId) return;
  await runMutation('voteUp', { id: `vote-${targetId}`, targetId, userId: 'demo-viewer' });
}

/**
 * `on:load` island: pre-warm the (async, WASM) database + app build so the first
 * click is responsive. Safe to call repeatedly.
 */
export function installBackend(): void {
  void ensureHandler();
}

export default installBackend;
