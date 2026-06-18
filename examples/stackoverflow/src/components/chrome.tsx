/** @jsxImportSource @kovojs/server */
import { csrfField } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

import { soCsrf, voteUpMutation } from '../mutations.js';
import type { SoRequest } from '../runtime.js';

// Shared page chrome and small rendering helpers for the StackOverflow demo.

// The demo uses text ids for posted questions and answers.
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

// Native upvote form. The score stays as a sole text child so the generated
// binding can update it directly.
export function voteButton(questionId: string, value: number, request?: SoRequest): string {
  return (
    <form enhance mutation={voteUpMutation} key={questionId} class="so-vote">
      {request ? csrfField(request, soCsrf) : ''}
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

export function SoShell({ children }: { children?: unknown }): string {
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
      <main class="so-main">{children}</main>
    </div>
  );
}
