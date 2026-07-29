import { createMemoryStorage } from '@kovojs/core/storage';
import { publicScopedKey } from '@kovojs/core';

export const avatarStorage = createMemoryStorage();
export const avatarKey = publicScopedKey('avatars/current.png');

export async function saveAvatar(bytes: Uint8Array) {
  return avatarStorage.put(avatarKey, bytes, {
    contentType: 'image/png',
  });
}
