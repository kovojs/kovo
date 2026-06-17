/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { profileQuery, type ProfileResult } from './shared';

export const ProfileSummary = component({
  fragmentTarget: true,
  queries: { profile: profileQuery },
  render: ({ profile }: { profile: ProfileResult }) => (
    <profile-summary kovo-fragment-target="profile-summary">
      <h2>{profile.name}</h2>
    </profile-summary>
  ),
});
