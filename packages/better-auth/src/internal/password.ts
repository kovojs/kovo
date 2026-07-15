import {
  hashPassword as kovoHashPassword,
  verifyPassword as kovoVerifyPassword,
} from '@kovojs/server';

const pinnedKovoHashPassword = kovoHashPassword;
const pinnedKovoVerifyPassword = kovoVerifyPassword;

interface BetterAuthPasswordVerification {
  hash: string;
  password: string;
}

/** Route Better Auth credential storage through Kovo's boot-captured Argon2id-only sink. @internal */
export async function betterAuthHashPassword(password: string): Promise<string> {
  return pinnedKovoHashPassword(password);
}

/** Accept only Kovo's exact positive verifier result as Better Auth authentication evidence. @internal */
export async function betterAuthVerifyPassword({
  hash,
  password,
}: BetterAuthPasswordVerification): Promise<boolean> {
  const result = await pinnedKovoVerifyPassword(password, hash);
  return result.ok === true;
}
