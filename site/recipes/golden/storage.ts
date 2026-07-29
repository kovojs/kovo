import { createMemoryStorage, publicScopedKey } from '@kovojs/server';

export const avatarStorage = createMemoryStorage();

export async function saveAvatar(bytes: Uint8Array) {
  return avatarStorage.put(publicScopedKey('avatars/current.png'), bytes, {
    contentType: 'image/png',
  });
}
