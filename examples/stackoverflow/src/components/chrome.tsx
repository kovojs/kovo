/** @jsxImportSource @kovojs/server */
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

import { voteUpMutation } from '../mutations.js';

// Shared page chrome for the Stack Overflow example UI, restyled with @kovojs/ui
// (SPEC.md §6.1.1). The app-shell wraps each page() return in the document
// <html>/<head> (with the stylesheet), so these helpers render the <body>
// contents: a sticky top bar plus a centered main column. The @kovojs/ui exports
// are component({ render }) OBJECTS, not function tags, so we compose them by
// calling `Component.definition.render(props)` (which returns an HTML string).

// SPEC.md §6.3: postQuestion / postAnswer use text primary keys, so each rendered
// composer mints a unique id. The app-shell renders server-side (Node), where
// crypto.randomUUID is available; a fresh fragment re-render yields a new id, so
// sequential posts never collide.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Two-letter initials from an author display name (e.g. "Priya Nair" → "PN"),
// used as the AvatarFallback content. Falls back to the first character.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// A compact, dependency-free "relative time" label from an ISO timestamp. The
// demo data is timestamped near 2026-06-16, so this reads as "today / 2d ago".
const SO_NOW = Date.parse('2026-06-17T00:00:00Z');
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!iso || Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((SO_NOW - then) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** Parse the comma-separated `tags` column into a trimmed, non-empty list. */
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const chromeStyles = style.create(
  {
    authorAvatar: { fontSize: 12, height: 28, width: 28 },
  },
  { namespace: 'stackoverflowChrome', source: 'components/chrome.tsx' },
);

/** Render a row of tags as neutral @kovojs/ui Badges. */
export function renderTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return (
    <div class="flex flex-wrap gap-2">
      {tags.map((tag) => Badge.definition.render({ variant: 'neutral', children: tag }))}
    </div>
  );
}

/**
 * Render an author byline: a small avatar (initials fallback) + name and an
 * optional relative timestamp. Used on question and answer cards.
 */
export function renderAuthor(name: string, iso: string | undefined, verb: string): string {
  const avatar = Avatar.definition.render({
    label: name,
    children: AvatarFallback.definition.render({ children: initials(name) }),
    styles: { root: chromeStyles.authorAvatar },
  });
  const when = iso ? relativeTime(iso) : '';
  return (
    <div class="flex items-center gap-2 text-xs text-slate-500">
      {avatar}
      <span class="font-medium text-slate-700">{name}</span>
      <span class="text-slate-400">
        {verb}
        {when ? ` · ${when}` : ''}
      </span>
    </div>
  );
}

// SPEC.md §6.3: a no-JS upvote form. It POSTs to the `voteUp` mutation endpoint;
// served by the Node app, the inline loader (§9.1) intercepts the submit, fetches
// the fragment wire, and morphs the re-rendered region with the server-truth
// score. The hidden `id` satisfies the mutation input schema (the votes row uses
// a serial key, so the handler ignores it); `userId` is the demo viewer.
//
// IMPORTANT (SPEC.md §9.1): the `{value}` here is the data-bound vote score the
// compiler stamps; it must stay a JSX sole-text-child, so it is authored inline
// and never passed through a `.definition.render({ children })` call.
export function voteButton(questionId: string, value: number): string {
  return (
    <form enhance mutation={voteUpMutation} class="so-vote">
      <input type="hidden" name="id" value={`vote-${questionId}`} />
      <input type="hidden" name="targetId" value={questionId} />
      <input type="hidden" name="userId" value="demo-viewer" />
      <button type="submit" aria-label="Upvote" class="so-vote-btn">
        <span class="so-vote-caret">&#9650;</span>
        <span class="so-vote-score tabular-nums">{value}</span>
        <span class="so-vote-label">votes</span>
      </button>
    </form>
  );
}

export function renderSoShell(body: string): string {
  return (
    <div class="so-app">
      <header class="so-header">
        <div class="so-header-inner">
          <a href="/" class="so-brand">
            <span class="so-brand-mark">DO</span>
            <span class="so-brand-name">DevOverflow</span>
          </a>
          <nav class="so-nav">
            <a href="/" class="so-nav-link so-nav-link--active">
              Questions
            </a>
            <a href="/" class="so-nav-link">
              Tags
            </a>
            <a href="/" class="so-nav-link">
              Users
            </a>
          </nav>
        </div>
      </header>
      <main class="so-main">{body}</main>
    </div>
  );
}
