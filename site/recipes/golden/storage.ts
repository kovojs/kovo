import { createMemoryStorage } from '@kovojs/core/storage';
import { publicScopedKey } from '@kovojs/core';

export const avatarStorage = createMemoryStorage();

export async function saveAvatar(bytes: Uint8Array) {
  return avatarStorage.put(publicScopedKey('avatars/current.png'), bytes, {
    contentType: 'image/png',
  });
}
