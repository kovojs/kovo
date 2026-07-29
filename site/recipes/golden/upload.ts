import { createMemoryStorage } from '@kovojs/core/storage';
import { s } from '@kovojs/server';

const uploads = createMemoryStorage();

export const avatarUpload = s
  .file()
  .maxBytes(2_000_000)
  .accept(['image/png'])
  .store({ keyPrefix: 'avatars', storage: uploads });
