/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { saveDraft } from './app';
import { profileQuery, type ProfileResult } from './shared';

const saveDraftForm = form<'profile/save-draft', { draft: string }>('profile/save-draft');

export const ProfileEditor = component({
  mutations: { saveDraft: saveDraftForm },
  queries: { profile: profileQuery },
  render: ({ profile }: { profile: ProfileResult }) => (
    <section kovo-key="profile-editor">
      <form key="draft-form" mutation={saveDraft} enhance>
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
