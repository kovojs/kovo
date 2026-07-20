import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkDeploymentEnvironment,
  DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
} from './deployment-environment-contract.js';
import { main } from './index.js';

// @kovo-security-classifier-corpus csrf-principal-binding
// @kovo-security-certifies C13 deployment-environment-assume-guarantee

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('assume-guarantee deployment environment contract', () => {
  it('derives retained obligations from consuming doors and discharges only observable fixed-origin proxy posture', () => {
    const result = checkDeploymentEnvironment(
      {
        composition: { kind: 'single-kovo' },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      {
        KOVO_NODE_ORIGIN: 'https://app.example.test',
        NODE_ENV: 'production',
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('kovo-check-env/v1');
    expect(result.output).toContain(
      'DISCHARGED antecedent=trusted-proxy-chain probe=fixed-origin-zero-hop',
    );
    expect(result.output).toContain('RETAINED antecedent=bootstrap-order');
    expect(result.output).toContain(
      'guarantees=explicit-secret-query-wire-egress,pglite-secret-column-reader-role-test-floor,pglite-secret-view-reader-role-test-floor',
    );
    expect(result.output).toContain('RETAINED antecedent=no-shared-cache');
    expect(result.output).toContain('GUARANTEE csrf-principal-binding SUSPENDED');
    expect(result.output).not.toContain('GUARANTEE csrf-principal-binding ACTIVE');
  });

  it('fails the Kovo x Kovo composition case because shared registrable-domain occupancy contradicts CSRF binding', () => {
    const result = checkDeploymentEnvironment(
      {
        composition: {
          kind: 'shared-registrable-domain',
          members: [
            { appId: 'accounts', origin: 'https://accounts.example.test' },
            { appId: 'shop', origin: 'https://shop.example.test' },
          ],
          registrableDomain: 'example.test',
        },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      { KOVO_NODE_ORIGIN: 'https://shop.example.test', NODE_ENV: 'production' },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('COMPOSITION shared-registrable-domain');
    expect(result.output).toContain(
      'CONTRADICTED antecedent=sole-registrable-domain-occupant probe=known-kovo-members:2 guarantees=csrf-principal-binding',
    );
    expect(result.output).toContain(
      'GUARANTEE csrf-principal-binding WITHHELD antecedents=sole-registrable-domain-occupant',
    );
  });

  it('accepts only an explicit mounted posture for a foreign host and withholds host-owned claims', () => {
    const standalone = checkDeploymentEnvironment(
      {
        composition: {
          hostOrigin: 'https://host.example.test',
          kind: 'foreign-host',
          mountPath: '/kovo',
        },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      {},
    );
    expect(standalone.exitCode).toBe(1);
    expect(standalone.output).toContain(
      'ERROR INPUT posture foreign-host composition requires posture=mounted',
    );

    const mounted = checkDeploymentEnvironment(
      {
        composition: {
          hostOrigin: 'https://host.example.test',
          kind: 'foreign-host',
          mountPath: '/kovo',
        },
        posture: 'mounted',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      {},
    );
    expect(mounted.exitCode).toBe(1);
    expect(mounted.output).toContain('POSTURE mounted');
    expect(mounted.output).toContain('GUARANTEE csrf-principal-binding WITHHELD posture=mounted');
    expect(mounted.output).toContain('GUARANTEE request-origin-binding WITHHELD posture=mounted');
    expect(mounted.output).not.toContain('posture=mounted proof=');
  });

  it('rejects authored proof verdicts, malformed compositions, and ambiguous proxy authority', () => {
    expect(
      checkDeploymentEnvironment(
        {
          composition: { kind: 'single-kovo' },
          discharged: ['bootstrap-order'],
          posture: 'standalone',
          schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
        },
        {},
      ).output,
    ).toContain('ERROR INPUT $.discharged is not a supported field');

    expect(
      checkDeploymentEnvironment(
        {
          composition: {
            kind: 'shared-registrable-domain',
            members: [
              { appId: 'one', origin: 'https://one.example.test' },
              { appId: 'two', origin: 'https://two.attacker.test' },
            ],
            registrableDomain: 'example.test',
          },
          posture: 'standalone',
          schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
        },
        {},
      ).output,
    ).toContain('ERROR INPUT $.composition.members[1].origin is outside example.test');

    expect(
      checkDeploymentEnvironment(
        {
          composition: {
            hostOrigin: 'https://host.example.test',
            kind: 'foreign-host',
            mountPath: '/kovo/../admin',
          },
          posture: 'mounted',
          schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
        },
        {},
      ).output,
    ).toContain('ERROR INPUT $.composition.mountPath must be one canonical non-root path prefix');

    const ambiguous = checkDeploymentEnvironment(
      {
        composition: { kind: 'single-kovo' },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      {
        KOVO_NODE_ORIGIN: 'https://app.example.test',
        KOVO_NODE_TRUSTED_PROXY: '1',
      },
    );
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.output).toContain(
      'CONTRADICTED antecedent=trusted-proxy-chain probe=ambiguous-node-authority',
    );
  });

  it('routes kovo check env through the stable command surface without treating the contract as graph.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-check-env-'));
    roots.push(root);
    writeFileSync(
      join(root, 'deployment.json'),
      JSON.stringify({
        composition: { kind: 'single-kovo' },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      }),
    );
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(
      main(['check', 'env', 'deployment.json'], {
        invocationCwd: root,
        invocationEnv: Object.freeze({
          KOVO_NODE_ORIGIN: 'https://app.example.test',
          NODE_ENV: 'production',
        }),
        paranoidStaticAdvisory: false,
      }),
    ).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('kovo-check-env/v1'));
  });
});
