/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { questionList } from '../queries.js';
import type { QuestionListItem } from '../model.js';
import { answersByUser, displayName, reputationOf, userById } from '../directory.js';
import { compactCount, initials, tagHref } from './chrome.js';
import { cardStyles, newestFirst, renderQuestionRow } from './question-card.js';

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
  gold: '#f1b600',
  silver: '#9fa6ad',
  bronze: '#d1a684',
} as const;

// `/users/:id` — a member profile: identity, reputation + badge stats, an about
// blurb, top tags, and the questions they have asked (read live from
// questionList and filtered by author).

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;

const SO_NOW = Date.parse('2026-06-17T00:00:00Z');

function memberFor(joinedAt: string): string {
  const joined = Date.parse(joinedAt);
  if (Number.isNaN(joined)) return 'new member';
  const years = (SO_NOW - joined) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    return `Member for ${months} month${months === 1 ? '' : 's'}`;
  }
  const rounded = Math.round(years);
  return `Member for ${rounded} year${rounded === 1 ? '' : 's'}`;
}

const profileStyles = style.create(
  {
    back: {
      alignItems: 'center',
      color: so.link,
      display: 'inline-flex',
      fontSize: 13,
      gap: 6,
      marginBlockEnd: 14,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    header: {
      alignItems: 'center',
      display: 'flex',
      gap: 20,
      '@media (max-width: 560px)': { alignItems: 'flex-start', flexDirection: 'column', gap: 14 },
    },
    avatar: {
      backgroundColor: '#3f7cb0',
      backgroundImage: 'linear-gradient(135deg, #6aa9d8 0%, #3f7cb0 100%)',
      borderRadius: 12,
      color: '#ffffff',
      display: 'grid',
      flexShrink: 0,
      fontSize: 40,
      fontWeight: 700,
      height: 110,
      placeItems: 'center',
      width: 110,
    },
    avatarYou: {
      backgroundColor: so.orange,
      backgroundImage: 'linear-gradient(135deg, #f9a14a 0%, #f48024 60%, #da680b 100%)',
    },
    identity: { display: 'grid', gap: 4, minWidth: 0 },
    name: {
      alignItems: 'center',
      color: so.text,
      display: 'flex',
      fontSize: 28,
      fontWeight: 500,
      gap: 10,
      margin: 0,
    },
    youTag: {
      backgroundColor: '#fdebd2',
      borderRadius: 4,
      color: so.orangeDark,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: '0.4px',
      paddingBlock: 2,
      paddingInline: 6,
      textTransform: 'uppercase',
    },
    sub: { color: so.textMuted, fontSize: 14 },
    subDim: { color: so.textLight, fontSize: 13 },
    statsRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      marginBlock: 22,
    },
    statTile: {
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      gap: 2,
      minWidth: 120,
      paddingBlock: 12,
      paddingInline: 14,
    },
    statValue: {
      color: so.text,
      fontSize: 22,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
      lineHeight: 1.1,
    },
    statLabel: { color: so.textMuted, fontSize: 12 },
    badgeTile: {
      alignItems: 'center',
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      gap: 14,
      paddingBlock: 12,
      paddingInline: 16,
    },
    badge: { alignItems: 'center', display: 'flex', fontSize: 13, gap: 5 },
    badgeText: { color: so.textSecondary, fontWeight: 600 },
    dot: { borderRadius: '50%', display: 'inline-block', height: 9, width: 9 },
    dotGold: { backgroundColor: so.gold },
    dotSilver: { backgroundColor: so.silver },
    dotBronze: { backgroundColor: so.bronze },
    sectionTitle: {
      borderBottomColor: so.border,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: so.text,
      fontSize: 18,
      fontWeight: 400,
      margin: 0,
      marginBlockEnd: 6,
      paddingBlockEnd: 8,
    },
    about: { color: so.textSecondary, fontSize: 14, lineHeight: 1.65, marginBlock: 12, maxWidth: 760 },
    tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBlock: 12 },
    tag: {
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      fontSize: 12,
      paddingBlock: 4,
      paddingInline: 7,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.tagBgHover, color: so.tagTextHover },
    },
    section: { marginBlockStart: 26 },
    empty: { color: so.textMuted, fontSize: 14, paddingBlock: 16 },
  },
  { namespace: 'profile', source: 'components/user-profile.tsx' },
);

function badgeDot(dotStyle: unknown, count: number, label: string): string {
  return (
    <span style={profileStyles.badge}>
      <span style={[profileStyles.dot, dotStyle]} />
      <span style={profileStyles.badgeText}>{count}</span> {label}
    </span>
  );
}

export const UserProfileRegion = component({
  props: { userId: String },
  queries: { questionList },
  render: (
    { questionList, userId }: { questionList: QuestionListQueryResult; userId: string },
  ) => {
    const items = questionList.items as QuestionListItem[];
    const theirQuestions = newestFirst(items.filter((item) => item.authorId === userId));
    const profile = userById(userId);
    const isCurrent = userId === 'demo-viewer';
    const name = displayName(userId, theirQuestions[0]?.authorName);
    const reputation = reputationOf(userId, name);
    const answers = answersByUser(userId);
    const badges = profile?.badges ?? { gold: 0, silver: 0, bronze: 0 };

    return (
      <div>
        <a style={profileStyles.back} href="/users">
          &larr; All users
        </a>
        <div style={profileStyles.header}>
          <span style={isCurrent ? [profileStyles.avatar, profileStyles.avatarYou] : profileStyles.avatar}>
            {initials(name)}
          </span>
          <div style={profileStyles.identity}>
            <h1 style={profileStyles.name}>
              {name}
              {isCurrent ? <span style={profileStyles.youTag}>You</span> : ''}
            </h1>
            {profile ? <span style={profileStyles.sub}>{profile.title}</span> : ''}
            <span style={profileStyles.subDim}>
              {profile ? `${profile.location} · ${memberFor(profile.joinedAt)}` : 'Community member'}
            </span>
          </div>
        </div>

        <div style={profileStyles.statsRow}>
          <div style={profileStyles.statTile}>
            <span style={profileStyles.statValue}>{reputation.toLocaleString('en-US')}</span>
            <span style={profileStyles.statLabel}>reputation</span>
          </div>
          <div style={profileStyles.statTile}>
            <span style={profileStyles.statValue}>{theirQuestions.length}</span>
            <span style={profileStyles.statLabel}>questions</span>
          </div>
          <div style={profileStyles.statTile}>
            <span style={profileStyles.statValue}>{answers}</span>
            <span style={profileStyles.statLabel}>answers</span>
          </div>
          <div style={profileStyles.badgeTile}>
            {badgeDot(profileStyles.dotGold, badges.gold, 'gold')}
            {badgeDot(profileStyles.dotSilver, badges.silver, 'silver')}
            {badgeDot(profileStyles.dotBronze, badges.bronze, 'bronze')}
          </div>
        </div>

        {profile ? (
          <div>
            <h2 style={profileStyles.sectionTitle}>About</h2>
            <p style={profileStyles.about}>{profile.about}</p>
            <div style={profileStyles.tagRow}>
              {profile.topTags.map((tag) => (
                <a href={tagHref(tag)} style={profileStyles.tag}>
                  {tag}
                </a>
              ))}
            </div>
          </div>
        ) : (
          ''
        )}

        <div style={profileStyles.section}>
          <h2 style={profileStyles.sectionTitle}>
            Questions ({theirQuestions.length})
          </h2>
          {theirQuestions.length > 0 ? (
            <ul style={cardStyles.list}>
              {theirQuestions.map((question) => renderQuestionRow(question, { interactive: false }))}
            </ul>
          ) : (
            <p style={profileStyles.empty}>{name} hasn&rsquo;t asked any questions yet.</p>
          )}
        </div>
      </div>
    );
  },
});
