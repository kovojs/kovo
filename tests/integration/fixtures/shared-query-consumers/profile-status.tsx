/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { profileQuery, type ProfileResult } from './shared';

export const ProfileStatus = component({
  fragmentTarget: true,
  queries: { profile: profileQuery },
  render: ({ profile }: { profile: ProfileResult }) => (
    <profile-status kovo-fragment-target="profile-status">
      <output>{profile.status}</output>
    </profile-status>
  ),
});
