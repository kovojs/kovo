import { expect, it } from 'vitest';

import { declareOffWire, publishToClient, redacted } from './secret.js';
import { validateTrustedSqlJustification } from './internal/sql-safety.js';

it('rejects controls and unbounded text from runtime audit and display escapes', () => {
  expect(() => publishToClient('x', { reason: 'reviewed\u2028fake row' })).toThrow(
    /printable text/,
  );
  expect(() => declareOffWire(() => {}, { justification: 'reviewed\u007ffake row' })).toThrow(
    /printable text/,
  );
  expect(() => validateTrustedSqlJustification('reviewed\rfake row')).toThrow(/printable text/);
  expect(() => redacted('private', { mask: 'safe\u202eforged' })).toThrow(/printable text/);
  expect(() => redacted('private', { mask: 'safe\u0085forged' })).toThrow(/printable text/);
});
