import { describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { createApp } from './app.js';
import { commandAllowlist } from './command.js';
import { unsafeCookie } from './cookies.js';
import { endpoint } from './endpoint.js';
import { committedSecretWaiver } from './env.js';
import { guard, guards } from './guards.js';
import { declarePublicRead } from './managed-db.js';
import { declarePublicRelation } from './postgres-runtime.js';
import { unsafeRegex } from './redos.js';
import { replayMutationWireBody, unsafeInline } from './response.js';
import { s } from './schema.js';
import { declareSecretReadCapability } from './secret-read-boundary.js';
import { accept } from './upload-sniff.js';
import { webhook } from './webhook.js';
import { serverValue, trustedAssign } from './write-governance.js';
import { snapshotAuditText } from './audit-justification.js';

const AUDIT_SPOOF_CODE_POINTS = [
  ...Array.from({ length: 0x20 }, (_, code) => code),
  ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset),
  0x061c,
  ...Array.from({ length: 0x05 }, (_, offset) => 0x200b + offset),
  ...Array.from({ length: 0x07 }, (_, offset) => 0x2028 + offset),
  ...Array.from({ length: 0x10 }, (_, offset) => 0x2060 + offset),
  0xfeff,
];

describe('server audited text floor (SPEC §6.6)', () => {
  it('rejects the complete C0/C1, invisible, and bidirectional spoof-control set', () => {
    for (const code of AUDIT_SPOOF_CODE_POINTS) {
      const label = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
      expect(
        () => snapshotAuditText(`reviewed${String.fromCharCode(code)}FORGED AUDIT ROW`, 'test'),
        label,
      ).toThrow(/control characters/u);
    }
  });

  it.each(['\n', '\u0085', '\u200b', '\u202e', '\u2066', '\ufeff'])(
    'routes spoof controls through representative server audit APIs',
    (control) => {
      const forged = `reviewed${control}FORGED AUDIT ROW`;

      expect(() => unsafeRegex(/x/u, forged)).toThrow(/printable|control/u);
      expect(() => trustedAssign('admin', forged)).toThrow(/printable|control/u);
      expect(() => publicAccess(forged)).toThrow(/printable|control/u);
      expect(() => committedSecretWaiver('fixture', { justification: forged })).toThrow(
        /printable|control/u,
      );
      expect(() => replayMutationWireBody('cached', { reason: forged })).toThrow(
        /printable|control/u,
      );
    },
  );

  it('rejects an audit string larger than the bounded fact budget', () => {
    const oversized = 'a'.repeat(4_097);

    expect(() => unsafeRegex(/x/u, oversized)).toThrow(/4096/u);
    expect(() => trustedAssign('admin', oversized)).toThrow(/4096/u);
    expect(() => publicAccess(oversized)).toThrow(/4096/u);
    expect(() => committedSecretWaiver('fixture', { justification: oversized })).toThrow(/4096/u);
    expect(() => replayMutationWireBody('cached', { reason: oversized })).toThrow(/4096/u);
    expect(() => unsafeRegex(new RegExp(oversized, 'u'), 'bounded source regression')).toThrow(
      /4096/u,
    );
  });

  it('applies the floor across server declarations, capabilities, and runtime audit facts', () => {
    const forged = 'reviewed\u202eFORGED AUDIT ROW';

    expect(() => commandAllowlist([process.execPath], { justification: forged })).toThrow(
      /control characters/u,
    );
    expect(() => serverValue('admin', forged)).toThrow(/control characters/u);
    expect(() => unsafeInline(forged)).toThrow(/control characters/u);
    expect(() => unsafeCookie({ downgrade: { secure: false }, justification: forged })).toThrow(
      /control characters/u,
    );
    expect(() => accept.unverified(['text/plain'], forged)).toThrow(/control characters/u);
    expect(() => accept.unverified([`text/plain${forged}`], 'legacy importer')).toThrow(
      /string array/u,
    );
    expect(() => declarePublicRead({ reason: forged })).toThrow(/control characters/u);
    expect(() => declarePublicRelation({ relation: 'public_report', reason: forged })).toThrow(
      /control characters/u,
    );
    expect(() =>
      declareSecretReadCapability(
        {},
        { columns: ['secret'], justification: forged, source: 'audit test', table: 'users' },
      ),
    ).toThrow(/control characters/u);
    expect(() =>
      endpoint('/audit-text', {
        csrf: false,
        csrfJustification: 'read-only regression fixture',
        handler: () => new Response('ok'),
        method: 'GET',
        reason: forged,
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
      }),
    ).toThrow(/control characters/u);
    expect(() => createApp({ egress: { enabled: false, justification: forged } })).toThrow(
      /control characters/u,
    );
    expect(() =>
      webhook('/audit-text-webhook', {
        handler: () => ({ ok: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: forged,
      }),
    ).toThrow(/control characters/u);
  });

  it('rejects spoofable and unbounded guard audit metadata', () => {
    const forged = 'reviewed\u202eFORGED AUDIT ROW';

    expect(() => guard(forged, () => true)).toThrow(/control characters/u);
    expect(() => guards.role(forged)).toThrow(/control characters/u);
    expect(() =>
      guards.owns(
        (request: { id: string; session?: { user?: { id?: string } | null } | null }) => request.id,
        () => true,
        { name: forged },
      ),
    ).toThrow(/control characters/u);
    expect(() =>
      guards.owns(
        (request: { id: string; session?: { user?: { id?: string } | null } | null }) => request.id,
        () => true,
        { principal: forged },
      ),
    ).toThrow(/control characters/u);
    expect(() =>
      guards.owns(
        (request: { id: string; session?: { user?: { id?: string } | null } | null }) => request.id,
        () => true,
        { resourceKey: forged },
      ),
    ).toThrow(/control characters/u);
    expect(() =>
      guards.owns(
        (request: { id: string; session?: { user?: { id?: string } | null } | null }) => request.id,
        () => true,
        {
          principal: { expression: 'session.user.id', path: forged, source: 'session' },
        },
      ),
    ).toThrow(/control characters/u);
    const unnamed = () => true;
    Object.defineProperty(unnamed, 'name', { configurable: true, value: forged });
    expect(() => guards.all(unnamed)).toThrow(/control characters/u);
    expect(() => guard('g'.repeat(4_097), () => true)).toThrow(/4096/u);
  });
});
