import { describe, expect, it } from 'vitest';

import { publicScopedKey } from './scoped-key.js';
import {
  createS3CompatibleStorage,
  type S3CompatibleObjectClient,
  type S3CompatibleStorageOptions,
} from './storage.js';

describe('S3 storage authority snapshot', () => {
  it('retains the constructed client, bucket, and method after caller mutation', async () => {
    const reads: string[] = [];
    const client = (identity: string, body: string): S3CompatibleObjectClient => ({
      async deleteObject() {},
      async getObject(input) {
        reads.push(`${identity}:${input.bucket}:${input.key}`);
        return { body };
      },
      async headObject() {
        return undefined;
      },
      async putObject() {
        return {};
      },
    });
    const victimClient = client('victim-client', 'victim bytes');
    const options: S3CompatibleStorageOptions = {
      bucket: 'victim-bucket',
      client: victimClient,
    };
    const storage = createS3CompatibleStorage(options);
    options.bucket = 'attacker-bucket';
    options.client = client('attacker-client', 'attacker bytes');
    victimClient.getObject = client('substituted-method', 'substituted bytes').getObject;

    const result = await storage.get(publicScopedKey('private.pdf'));
    expect(new TextDecoder().decode(result?.body)).toBe('victim bytes');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/^victim-client:victim-bucket:kovo-storage-v1\/[a-f0-9]{64}$/u);
  });

  it('rejects accessor and inherited construction authority', () => {
    const stableClient: S3CompatibleObjectClient = {
      async deleteObject() {},
      async getObject() {
        return undefined;
      },
      async headObject() {
        return undefined;
      },
      async putObject() {
        return {};
      },
    };
    const accessorOptions = Object.create(null) as S3CompatibleStorageOptions;
    Object.defineProperty(accessorOptions, 'bucket', { get: () => 'accessor-bucket' });
    Object.defineProperty(accessorOptions, 'client', { value: stableClient });
    expect(() => createS3CompatibleStorage(accessorOptions)).toThrow('own data property');

    const inheritedOptions = Object.create({
      bucket: 'inherited-bucket',
      client: stableClient,
    }) as S3CompatibleStorageOptions;
    expect(() => createS3CompatibleStorage(inheritedOptions)).toThrow(
      'bucket must be an own string data property',
    );
  });
});
