/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { questionList } from '../queries.js';
import type { QuestionListItem } from '../model.js';
import { type DemoUser, DEMO_USERS } from '../directory.js';
import { compactCount, initials, tagHref } from './chrome.js';

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  orange: '#f48024',
  orangeDark: '#da680b',
  border: '#e3e6e8',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  textLight: '#6a737c',
  link: '#0074cc',
  linkHover: '#0a95ff',
  tagBg: '#e1ecf4',
  tagText: '#39739d',
  tagBgHover: '#cee0ed',
  tagTextHover: '#2c5877',
} as const;

// The Users index (`/users`): the community directory, each card showing the
// avatar, name, location, reputation, and top tags. Question counts are read
// live from questionList; reputation and profile come from the directory.

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;

const usersStyles = style.create(
  {
    title: { color: so.text, fontSize: 27, fontWeight: 400, marginBlock: 0 },
    count: { color: so.textSecondary, fontSize: 14, marginBlock: 12 },
    grid: {
      display: 'grid',
      gap: 16,
      gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))',
    },
    card: {
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 14,
    },
    top: { display: 'flex', gap: 10 },
    avatar: {
      backgroundColor: '#3f7cb0',
      backgroundImage: 'linear-gradient(135deg, #6aa9d8 0%, #3f7cb0 100%)',
      borderRadius: 6,
      color: '#ffffff',
      display: 'grid',
      flexShrink: 0,
      fontSize: 16,
      fontWeight: 700,
      height: 44,
      placeItems: 'center',
      width: 44,
    },
    avatarYou: {
      backgroundColor: so.orange,
      backgroundImage: 'linear-gradient(135deg, #f9a14a 0%, #f48024 60%, #da680b 100%)',
    },
    meta: { display: 'grid', gap: 2, minWidth: 0 },
    name: {
      color: so.link,
      fontSize: 14,
      fontWeight: 600,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    youTag: {
      backgroundColor: '#fdebd2',
      borderRadius: 3,
      color: so.orangeDark,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.4px',
      marginInlineStart: 6,
      paddingBlock: 1,
      paddingInline: 4,
      textTransform: 'uppercase',
    },
    location: {
      color: so.textLight,
      fontSize: 12,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    rep: {
      alignItems: 'baseline',
      color: so.textMuted,
      display: 'flex',
      fontSize: 12,
      gap: 5,
    },
    repValue: { color: so.textSecondary, fontSize: 14, fontWeight: 700 },
    stats: { color: so.textLight, fontSize: 12 },
    tagRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
    tag: {
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      fontSize: 11,
      paddingBlock: 3,
      paddingInline: 6,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.tagBgHover, color: so.tagTextHover },
    },
  },
  { namespace: 'users', source: 'components/users-page.tsx' },
);

function userCard(user: DemoUser, questionCount: number, isCurrent: boolean): string {
  return (
    <div style={usersStyles.card}>
      <div style={usersStyles.top}>
        <a href={`/users/${user.id}`} aria-label={user.name}>
          <span
            style={isCurrent ? [usersStyles.avatar, usersStyles.avatarYou] : usersStyles.avatar}
          >
            {initials(user.name)}
          </span>
        </a>
        <div style={usersStyles.meta}>
          <span>
            <a href={`/users/${user.id}`} style={usersStyles.name}>
              {user.name}
            </a>
            {isCurrent ? <span style={usersStyles.youTag}>You</span> : ''}
          </span>
          <span style={usersStyles.location}>{user.location}</span>
        </div>
      </div>
      <div style={usersStyles.rep}>
        <span style={usersStyles.repValue}>{compactCount(user.reputation)}</span>
        <span>reputation</span>
      </div>
      <div style={usersStyles.stats}>
        {questionCount} {questionCount === 1 ? 'question' : 'questions'} asked
      </div>
      <div style={usersStyles.tagRow}>
        {user.topTags.map((tag) => (
          <a href={tagHref(tag)} style={usersStyles.tag}>
            {tag}
          </a>
        ))}
      </div>
    </div>
  );
}

export const UsersPage = component({
  queries: { questionList },
  render: ({ questionList }: { questionList: QuestionListQueryResult }) => {
    const items = questionList.items as QuestionListItem[];
    const questionCounts = new Map<string, number>();
    for (const item of items) {
      questionCounts.set(item.authorId, (questionCounts.get(item.authorId) ?? 0) + 1);
    }
    const users = [...DEMO_USERS].sort((left, right) => right.reputation - left.reputation);
    return (
      <div>
        <h1 style={usersStyles.title}>Users</h1>
        <p style={usersStyles.count}>{users.length.toLocaleString('en-US')} users</p>
        <div style={usersStyles.grid}>
          {users.map((user) =>
            userCard(user, questionCounts.get(user.id) ?? 0, user.id === 'demo-viewer'),
          )}
        </div>
      </div>
    );
  },
});
