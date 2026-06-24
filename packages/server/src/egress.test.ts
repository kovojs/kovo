import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';

import { describe, expect, it, vi } from 'vitest';
import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import {
  EgressBlockedError,
  assertEgressAllowed,
  createEgressDispatcher,
  createEgressFetch,
  createMetadataCredentialProvider,
  installNodeEgressGuard,
  normalizeAllowInternal,
} from './egress.js';

const require = createRequire(import.meta.url);

describe('server egress private-network deny floor', () => {
  it('allows public destinations without declarations', async () => {
    await expect(
      assertEgressAllowed('https://api.example.test/v1', [], async () => '93.184.216.34'),
    ).resolves.toMatchObject({
      destination: 'api.example.test:443',
      ip: '93.184.216.34',
      private: false,
    });
  });

  it('blocks loopback, private, link-local, and metadata destinations by default', async () => {
    await expect(assertEgressAllowed('http://127.0.0.1:8080', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(assertEgressAllowed('http://10.0.5.2:6379', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(assertEgressAllowed('http://169.254.170.2/', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(
      assertEgressAllowed('http://metadata.google.internal/', [], async () => '169.254.169.254'),
    ).rejects.toMatchObject({
      destination: 'metadata.google.internal:80',
      status: 502,
    });
  });

  it('allows only exact configured internal host:port pairs', async () => {
    const allowInternal = normalizeAllowInternal(['LOCALHOST:11434', '10.0.5.2:6379']);

    await expect(assertEgressAllowed('http://localhost:11434/api', allowInternal)).resolves.toEqual(
      expect.objectContaining({
        destination: 'localhost:11434',
        private: true,
      }),
    );
    await expect(assertEgressAllowed('http://localhost:8080/api', allowInternal)).rejects.toThrow(
      /localhost:8080/,
    );
  });

  it('denies metadata endpoints even when they appear in allowInternal', async () => {
    const allowInternal = normalizeAllowInternal(['169.254.169.254:80', '169.254.170.2:80']);

    await expect(
      assertEgressAllowed('http://169.254.169.254/latest', allowInternal),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(
      assertEgressAllowed('http://169.254.170.2/creds', allowInternal),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('allows metadata destinations only inside the framework credential-provider frame', async () => {
    const readAwsMetadata = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return assertEgressAllowed(
        'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        [],
      );
    };
    const wrappedCredential = createMetadataCredentialProvider(readAwsMetadata);

    await expect(readAwsMetadata()).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(wrappedCredential()).resolves.toMatchObject({
      destination: '169.254.169.254:80',
      ip: '169.254.169.254',
      private: true,
    });
    await expect(readAwsMetadata()).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('blocks Azure identity endpoints through allowInternal unless a credential provider entered the frame', async () => {
    const http = require('node:http') as typeof import('node:http');
    const previousIdentityEndpoint = process.env['IDENTITY_ENDPOINT'];
    const server = createServer((_request, response) => {
      response.end('token');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected TCP server');

    const identityEndpoint = `http://127.0.0.1:${address.port}/metadata/identity/oauth2/token`;
    process.env['IDENTITY_ENDPOINT'] = identityEndpoint;
    const guard = installNodeEgressGuard({
      allowInternal: [`127.0.0.1:${address.port}`],
    });
    const readAzureIdentityEndpoint = () =>
      new Promise<string>((resolve, reject) => {
        try {
          http
            .get(identityEndpoint, (response) => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', (chunk: string) => {
                body += chunk;
              });
              response.on('end', () => resolve(body));
            })
            .on('error', reject);
        } catch (error) {
          reject(error);
        }
      });
    const wrappedCredential = createMetadataCredentialProvider(readAzureIdentityEndpoint);

    try {
      await expect(readAzureIdentityEndpoint()).rejects.toBeInstanceOf(EgressBlockedError);
      await expect(wrappedCredential()).resolves.toBe('token');
    } finally {
      guard.uninstall();
      if (previousIdentityEndpoint === undefined) {
        delete process.env['IDENTITY_ENDPOINT'];
      } else {
        process.env['IDENTITY_ENDPOINT'] = previousIdentityEndpoint;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('normalizes numeric and mapped private IP spellings before deciding', async () => {
    await expect(assertEgressAllowed('http://2130706433/', [])).rejects.toMatchObject({
      ip: '127.0.0.1',
    });
    await expect(assertEgressAllowed('http://0x7f000001/', [])).rejects.toMatchObject({
      ip: '127.0.0.1',
    });
    await expect(assertEgressAllowed('http://[64:ff9b::a9fe:a9fe]/', [])).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('rechecks each redirect hop before following it', async () => {
    const baseFetch = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        headers: { Location: 'http://127.0.0.1/admin' },
        status: 302,
      });
    });
    const guardedFetch = createEgressFetch(
      { allowInternal: [] },
      {
        fetch: baseFetch,
        resolver: async (host) => (host === 'api.example.test' ? '93.184.216.34' : '127.0.0.1'),
      },
    );

    await expect(guardedFetch('https://api.example.test/start')).rejects.toMatchObject({
      destination: '127.0.0.1:80',
      status: 502,
    });
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks raw node:http metadata requests before dispatch', () => {
    const http = require('node:http') as typeof import('node:http');
    const guard = installNodeEgressGuard({ allowInternal: ['169.254.169.254:80'] });

    try {
      expect(() => http.get('http://169.254.169.254/latest/meta-data/')).toThrow(
        EgressBlockedError,
      );
    } finally {
      guard.uninstall();
    }
  });

  it('blocks raw undici metadata requests before dispatch', async () => {
    const guard = installNodeEgressGuard({ allowInternal: ['169.254.169.254:80'] });

    try {
      await expect(undiciFetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
        cause: expect.any(EgressBlockedError),
      });
    } finally {
      guard.uninstall();
    }
  });

  it('blocks raw global fetch metadata requests before dispatch', async () => {
    const guard = installNodeEgressGuard({ allowInternal: ['169.254.169.254:80'] });

    try {
      await expect(
        globalThis.fetch('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toMatchObject({
        cause: expect.any(EgressBlockedError),
      });
    } finally {
      guard.uninstall();
    }
  });

  it('rechecks raw undici redirect hops before dispatch', async () => {
    const originalDispatcher = getGlobalDispatcher();
    const server = createServer((_request, response) => {
      response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected TCP server');

    const agent = new Agent({
      connect(options, callback) {
        const socket = netConnect(Number(options.port), '127.0.0.1');
        socket.once('connect', () => callback(null, socket));
        socket.once('error', (error) => callback(error, null));
      },
    });
    setGlobalDispatcher(
      createEgressDispatcher(agent, {
        allowInternal: [],
        resolver: async (host) =>
          host === 'public-hop.test' ? '93.184.216.34' : '169.254.169.254',
      }),
    );

    try {
      await expect(
        undiciFetch(`http://public-hop.test:${address.port}/start`),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          destination: '169.254.169.254:80',
          status: 502,
        }),
      });
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await agent.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('blocks raw net connects to private addresses outside allowInternal', () => {
    const net = require('node:net') as typeof import('node:net');
    const guard = installNodeEgressGuard({ allowInternal: [] });

    try {
      expect(() => net.connect({ host: '127.0.0.1', port: 80 })).toThrow(EgressBlockedError);
    } finally {
      guard.uninstall();
    }
  });

  it('blocks raw net connects to metadata addresses even when allowInternal lists them', () => {
    const net = require('node:net') as typeof import('node:net');
    const guard = installNodeEgressGuard({ allowInternal: ['169.254.169.254:80'] });

    try {
      expect(() => net.connect({ host: '169.254.169.254', port: 80 })).toThrow(EgressBlockedError);
    } finally {
      guard.uninstall();
    }
  });

  it('allows raw node:http requests to exact configured internal host:port pairs', async () => {
    const http = require('node:http') as typeof import('node:http');
    const server = createServer((_request, response) => {
      response.end('ok');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected TCP server');

    const guard = installNodeEgressGuard({ allowInternal: [`127.0.0.1:${address.port}`] });

    try {
      await expect(
        new Promise<string>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${address.port}/health`, (response) => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', (chunk: string) => {
                body += chunk;
              });
              response.on('end', () => resolve(body));
            })
            .on('error', reject);
        }),
      ).resolves.toBe('ok');
    } finally {
      guard.uninstall();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('rechecks undici dispatches before pooled socket reuse', async () => {
    const originalDispatcher = getGlobalDispatcher();
    const server = createServer((_request, response) => {
      response.setHeader('Connection', 'keep-alive');
      response.end('ok');
    });
    let connections = 0;
    server.on('connection', () => {
      connections += 1;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected TCP server');

    const policyAddresses = ['93.184.216.34', '127.0.0.1'];
    const agent = new Agent({
      connect(options, callback) {
        const socket = netConnect(Number(options.port), '127.0.0.1');
        socket.once('connect', () => callback(null, socket));
        socket.once('error', (error) => callback(error, null));
      },
      connections: 1,
    });
    setGlobalDispatcher(
      createEgressDispatcher(agent, {
        allowInternal: [],
        resolver: async () => policyAddresses.shift() ?? '127.0.0.1',
      }),
    );

    try {
      await expect(undiciFetch(`http://rebind.test:${address.port}/first`)).resolves.toMatchObject({
        status: 200,
      });
      await expect(undiciFetch(`http://rebind.test:${address.port}/second`)).rejects.toMatchObject({
        cause: expect.objectContaining({
          destination: `rebind.test:${address.port}`,
          ip: '127.0.0.1',
          status: 502,
        }),
      });
      expect(connections).toBe(1);
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await agent.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});
