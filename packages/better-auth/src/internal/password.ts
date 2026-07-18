import {
  hashPassword as kovoHashPassword,
  verifyPassword as kovoVerifyPassword,
} from '@kovojs/server';

import {
  betterAuthCredentialConsumers,
  consumeBetterAuthCredentialResult,
  runBetterAuthCredentialSourceCallableAsync,
} from './credential-runtime-gate.js';

const pinnedKovoHashPassword = kovoHashPassword;
const pinnedKovoVerifyPassword = kovoVerifyPassword;

interface BetterAuthPasswordVerification {
  hash: string;
  password: string;
}

/** Route Better Auth credential storage through Kovo's boot-captured Argon2id-only sink. @internal */
export async function betterAuthHashPassword(password: string): Promise<string> {
  const consumer = betterAuthCredentialConsumers.passwordHash;
  const result = await runBetterAuthCredentialSourceCallableAsync<string>(
    consumer,
    'password.hash',
    pinnedKovoHashPassword,
    undefined,
    [password],
  );
  return consumeBetterAuthCredentialResult(consumer, result);
}

/** Accept only Kovo's exact positive verifier result as Better Auth authentication evidence. @internal */
export async function betterAuthVerifyPassword({
  hash,
  password,
}: BetterAuthPasswordVerification): Promise<boolean> {
  const consumer = betterAuthCredentialConsumers.passwordVerify;
  const result = await runBetterAuthCredentialSourceCallableAsync<boolean>(
    consumer,
    'password.verify',
    pinnedKovoVerifyPassword,
    undefined,
    [password, hash],
  );
  return consumeBetterAuthCredentialResult(consumer, result);
}
