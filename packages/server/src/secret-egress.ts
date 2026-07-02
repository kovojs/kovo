import { isSecret } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

export class SecretEgressError extends Error {
  readonly code = 'KV435' as const;

  constructor(channel: string) {
    super(
      `KV435 ${diagnosticDefinitions.KV435.message} Secret runtime value cannot cross ${channel}; reveal or redact it explicitly before egress.`,
    );
    this.name = 'SecretEgressError';
  }
}

export function assertNoSecretEgressValue(value: unknown, channel: string): void {
  if (isSecret(value)) throw new SecretEgressError(channel);
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSecretEgressValue(entry, channel);
  }
}
