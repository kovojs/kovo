// Authenticated-session helper. Form login through Kovo's progressively-enhanced
// flow carries the server-rendered CSRF token automatically (the hidden `csrf`
// field is part of the rendered form), so a test just supplies credentials. This
// hides the CSRF/session dance that the commerce scratch drive script hand-rolled.
import type { Page } from '@playwright/test';

/* eslint-disable typescript/unbound-method */

import {
  verifierArrayPush,
  verifierApply,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierOwnKeys,
  verifierPromiseAll3,
  verifierStringIncludes,
  verifierUrlSnapshot,
} from '../verifier-security-intrinsics.js';

const nativeStringCharCodeAt = String.prototype.charCodeAt;
const nativeNumberToString = Number.prototype.toString;

/** Options for `login`. */
export interface LoginOptions {
  /** Field name → value to fill. Defaults assume `email`/`password`. */
  fields: Record<string, string>;
  /** Route that renders the login form. Default `/login`. */
  loginPath?: string;
  /** Accessible name (or selector) of the submit control. Default a submit button. */
  submit?: string;
  /** Mutation path the submit posts to; awaited to confirm success. Default `/_m/**`. */
  awaitMutation?: string;
}

/**
 * Log in by submitting the rendered login form and waiting for the sign-in
 * mutation to succeed and its principal-changing full navigation to settle.
 * Establishes the session cookie on the page's context.
 */
export async function login(page: Page, origin: string, options: LoginOptions): Promise<void> {
  const stable = snapshotLoginOptions(options);
  const loginPath = stable.loginPath ?? '/login';
  const originUrl = verifierUrlSnapshot(origin);
  const loginUrl = verifierUrlSnapshot(loginPath, originUrl.href);
  if (
    loginUrl.origin !== originUrl.origin ||
    loginUrl.username !== '' ||
    loginUrl.password !== ''
  ) {
    throw new TypeError('Kovo integration login path must resolve on the fixture origin.');
  }
  await page.goto(loginUrl.href, { waitUntil: 'networkidle' });

  for (let index = 0; index < stable.fields.length; index += 1) {
    const [name, value] = stable.fields[index] as readonly [string, string];
    await page.fill(loginFieldSelector(name), value);
  }

  const mutationMatch = stable.awaitMutation;
  const submit = stable.submit
    ? page.getByRole('button', { name: stable.submit })
    : page.locator('button[type="submit"], input[type="submit"]').first();

  const responseReady = page.waitForResponse(
    (response) =>
      verifierStringIncludes(response.url(), mutationMatch ?? '/_m/') && response.status() < 400,
    { timeout: 15_000 },
  );
  const navigationReady = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 15_000,
  });
  const submitted = submit.click();
  await verifierPromiseAll3(
    responseReady,
    // SPEC §9.3: a successful session-establishing mutation retires the page-load principal and
    // performs a full navigation. Waiting only for the mutation headers lets callers race that
    // reload with their next page.goto(), so the helper's completion boundary is the new document.
    navigationReady,
    submitted,
  );
  await page.waitForLoadState('networkidle');
}

interface StableLoginOptions {
  readonly awaitMutation?: string;
  readonly fields: readonly (readonly [string, string])[];
  readonly loginPath?: string;
  readonly submit?: string;
}

function snapshotLoginOptions(options: LoginOptions): StableLoginOptions {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Kovo integration login options must be an object.');
  }
  const fields = ownData(options, 'fields', 'login options');
  if (typeof fields !== 'object' || fields === null) {
    throw new TypeError('Kovo integration login fields must be an own-data object.');
  }
  const fieldEntries: (readonly [string, string])[] = [];
  const names = verifierOwnKeys(fields);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (typeof name !== 'string') throw new TypeError('Login fields must not use symbol names.');
    const value = ownData(fields, name, 'login fields');
    if (typeof value !== 'string') throw new TypeError(`Login field ${name} must be a string.`);
    verifierArrayPush(fieldEntries, verifierFreeze([name, value] as const));
  }
  const loginPath = optionalString(options, 'loginPath');
  const submit = optionalString(options, 'submit');
  const awaitMutation = optionalString(options, 'awaitMutation');
  return verifierFreeze({
    ...(awaitMutation === undefined ? {} : { awaitMutation }),
    fields: verifierFreeze(fieldEntries),
    ...(loginPath === undefined ? {} : { loginPath }),
    ...(submit === undefined ? {} : { submit }),
  });
}

function optionalString(options: object, property: string): string | undefined {
  const value = ownData(options, property, 'login options');
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`Login option ${property} must be a string own data property.`);
  }
  return value;
}

function ownData(value: object, property: PropertyKey, label: string): unknown {
  const first = verifierGetOwnPropertyDescriptor(value, property);
  const second = verifierGetOwnPropertyDescriptor(value, property);
  if (first === undefined && second === undefined) return undefined;
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  ) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return first.value;
}

/** @internal Exact CSS string selector for one login field name. */
export function loginFieldSelector(name: string): string {
  let escaped = '';
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index] ?? '';
    const safe =
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character === '-' ||
      character === '_';
    if (safe) {
      escaped += character;
      continue;
    }
    const charCode = verifierApply<number>(nativeStringCharCodeAt, character, [0]);
    const code = verifierApply<string>(nativeNumberToString, charCode, [16]);
    escaped += `\\${code} `;
  }
  return `[name="${escaped}"]`;
}
