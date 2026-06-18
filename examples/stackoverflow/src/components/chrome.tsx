/** @jsxImportSource @kovojs/server */
import { csrfField } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

import { soCsrf, voteUpMutation } from '../mutations.js';
import type { SoRequest } from '../model.js';
import { soStyles } from '../styles.js';

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

/** Render a row of tags as neutral @kovojs/ui Badges. */
export function renderTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return (
    <div {...style.attrs(soStyles.tagRow)}>
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
    styles: { root: soStyles.authorAvatar },
  });
  const when = iso ? relativeTime(iso) : '';
  return (
    <div {...style.attrs(soStyles.byline)}>
      {avatar}
      <span {...style.attrs(soStyles.bylineName)}>{name}</span>
      <span {...style.attrs(soStyles.bylineMeta)}>
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
    <form enhance mutation={voteUpMutation} key={questionId} {...style.attrs(soStyles.voteForm)}>
      {request ? csrfField(request, soCsrf) : ''}
      <input type="hidden" name="id" value={`vote-${questionId}`} />
      <input type="hidden" name="targetId" value={questionId} />
      <input type="hidden" name="userId" value="demo-viewer" />
      <button type="submit" aria-label="Upvote" {...style.attrs(soStyles.voteButton)}>
        <span {...style.attrs(soStyles.voteCaret)}>&#9650;</span>
        <span {...style.attrs(soStyles.voteScore)}>{value}</span>
        <span {...style.attrs(soStyles.voteLabel)}>votes</span>
      </button>
    </form>
  );
}

export function SoShell({ children }: { children?: unknown }): string {
  return (
    <div {...style.attrs(soStyles.appRoot)}>
      <header {...style.attrs(soStyles.header)}>
        <div {...style.attrs(soStyles.headerInner)}>
          <a href="/" {...style.attrs(soStyles.brand)}>
            <span {...style.attrs(soStyles.brandMark)}>DO</span>
            <span {...style.attrs(soStyles.brandName)}>DevOverflow</span>
          </a>
          <nav {...style.attrs(soStyles.nav)}>
            <a href="/" {...style.attrs(soStyles.navLink, soStyles.navLinkActive)}>
              Questions
            </a>
            <a href="/" {...style.attrs(soStyles.navLink)}>
              Tags
            </a>
            <a href="/" {...style.attrs(soStyles.navLink)}>
              Users
            </a>
          </nav>
        </div>
      </header>
      <main {...style.attrs(soStyles.main)}>{children}</main>
    </div>
  );
}
