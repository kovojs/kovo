// @kovo-security-classifier-corpus postgres-identity-posture
import { describe, expect, it } from 'vitest';

import { guards } from './guards.js';
import { authorizationCorrespondenceFactsFromApp } from './postgres-authorization-explain.js';

describe('Postgres authorization production explain facts', () => {
  it('pairs each exact surface guard with its table policy without aggregating unrelated guards', () => {
    const ownsDocuments = guards.owns<{
      args: { id: string };
      session?: { user?: { id?: string } };
    }>(
      (request) => request.args.id,
      async () => true,
      { resourceKey: 'args.id' },
    );
    const billingRole = guards.role('billing');
    const app = {
      mutations: [{ access: [billingRole], key: 'invoice/update' }],
      queries: [{ access: [ownsDocuments], key: 'document/read' }],
      routes: [],
    };

    const facts = authorizationCorrespondenceFactsFromApp({
      app,
      mutations: [{ key: 'invoice/update', writes: ['invoice'] }],
      pages: [],
      queries: [{ domains: ['document'], query: 'document/read' }],
      tableSecurity: {
        tables: [
          {
            authorizationClassifications: ['owned'],
            columns: [
              { key: 'id', name: 'id' },
              { key: 'ownerId', name: 'owner_id' },
            ],
            dialect: 'postgres',
            domain: 'document',
            governedColumnKeys: ['id', 'ownerId'],
            name: 'documents',
            owner: { columnKey: 'ownerId', columnName: 'owner_id' },
            secretColumnKeys: [],
            secretDeclared: false,
          },
          {
            authzPolicy: {
              kind: 'sql',
              sql: `organization_id = current_setting('kovo.principal', true)`,
            },
            authorizationClassifications: ['authzPolicy'],
            columns: [{ key: 'id', name: 'id' }],
            dialect: 'postgres',
            domain: 'invoice',
            governedColumnKeys: ['id'],
            name: 'invoices',
            secretColumnKeys: [],
            secretDeclared: false,
          },
          {
            authorizationClassifications: ['owned'],
            columns: [{ key: 'ownerId', name: 'owner_id' }],
            dialect: 'sqlite',
            domain: 'local-document',
            governedColumnKeys: ['ownerId'],
            name: 'local_documents',
            owner: { columnKey: 'ownerId', columnName: 'owner_id' },
            secretColumnKeys: [],
            secretDeclared: false,
          },
        ],
      },
    });

    expect(facts).toHaveLength(6);
    expect(
      facts.find(
        (fact) => fact.surface.kind === 'query' && fact.surface.name === 'document/read',
      ),
    ).toMatchObject({
      activation: { source: 'build', status: 'environment-unchecked' },
      correspondence: {
        guard: {
          facts: [{ kind: 'owns', resourceKey: expect.objectContaining({ path: 'args.id' }) }],
          semantics: 'arbitrary-app-callback',
        },
        rls: { emissionSite: 'owner', tableName: 'documents' },
        roleGuc: { readers: 0, status: 'dead', writers: 1 },
        status: 'unproven',
      },
      surface: { kind: 'query', name: 'document/read' },
      table: { domain: 'document', name: 'documents' },
    });
    expect(
      facts.find(
        (fact) => fact.surface.kind === 'mutation' && fact.surface.name === 'invoice/update',
      ),
    ).toMatchObject({
      correspondence: {
        guard: { facts: [expect.objectContaining({ kind: 'role', role: 'billing' })] },
        rls: { emissionSite: 'authzPolicy', tableName: 'invoices' },
        status: 'unproven',
      },
      table: { domain: 'invoice', name: 'invoices' },
    });
    expect(
      facts.filter((fact) => fact.surface.kind === 'framework-policy').map((fact) => ({
        site: fact.correspondence.rls.emissionSite,
        table: fact.table.name,
      })),
    ).toEqual([
      { site: 'admin', table: 'documents' },
      { site: 'system', table: 'documents' },
      { site: 'admin', table: 'invoices' },
      { site: 'system', table: 'invoices' },
    ]);
    expect(facts.some((fact) => fact.table.name === 'local_documents')).toBe(false);
    expect(facts[0]?.correspondence.roleGuc.warning).toContain(
      'no generated RLS predicate reads it',
    );
  });
});
