import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv427 = diagnosticDefinitions.KV427;

describe('compiler cloud SDK credential diagnostics', () => {
  it('reports KV427 for declared cloud SDK clients with no credential option', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws', 'gcp', 'azure'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';
import { Storage as GcpStorage } from '@google-cloud/storage';
import * as AzureStorage from '@azure/storage-blob';

export const s3 = new S3Client({ region: 'us-east-1' });
export const gcs = new GcpStorage({ projectId: 'demo' });
export const blob = new AzureStorage.BlobServiceClient(accountUrl);
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 8,
        message: `${kv427.message} S3Client is imported from @aws-sdk/client-s3; add the declared cloud.aws credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 23, line: 6 },
      },
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 10,
        message: `${kv427.message} Storage is imported from @google-cloud/storage; add the declared cloud.gcp credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 24, line: 7 },
      },
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 30,
        message: `${kv427.message} BlobServiceClient is imported from @azure/storage-blob; add the declared cloud.azure credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 25, line: 8 },
      },
    ]);
  });

  it('does not report KV427 without a matching cloud metadata declaration', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['gcp'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({ region: 'us-east-1' });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });

  it('accepts explicit credential and provider-specific auth options', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws', 'gcp', 'azure'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';
import { BlobServiceClient, QueueClient } from '@azure/storage-blob';

export const s3 = new S3Client({ credentials: cloud.aws, region: 'us-east-1' });
export const gcs = new Storage({ authClient: cloud.gcp });
export const gcsKey = new Storage({ keyFilename: '/var/run/key.json' });
export const blob = new BlobServiceClient(accountUrl, cloud.azure);
export const queue = new QueueClient(queueUrl, { credential: cloud.azure });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });

  it('keeps the gate high-confidence by ignoring local constructor indirection', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';

const Client = S3Client;
export const s3 = new Client({ region: 'us-east-1' });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });
});
