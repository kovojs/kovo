/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { profileQuery, type ProfileResult } from './shared';

export const ProfileEditor = component({
  queries: { profile: profileQuery },
  render: ({ profile }: { profile: ProfileResult }) => (
    <section kovo-key="profile-editor">
      <form
        kovo-key="draft-form"
        method="post"
        action="/_m/profile/save-draft"
        enhance
        data-mutation="profile/save-draft"
      >
        <label for="draft">Draft</label>
        <input id="draft" name="draft" kovo-key="draft" value={`server draft ${profile.version}`} />
        <p>
          Server version <output>{profile.version}</output>
        </p>
        <button type="submit">Refresh server truth</button>
      </form>
    </section>
  ),
});
