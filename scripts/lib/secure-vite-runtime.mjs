import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

let compilerReady;
let runtimeReady;
let typeScriptHooksRegistered = false;

/** Establish compiler lockdown before importing compiler authority in a repo script. */
export function securityLockedCompilerRuntime() {
  compilerReady ??= (async () => {
    registerTypeScriptSourceHooks();
    const compilerBootstrap = await import(
      new URL('../../packages/compiler/src/security-bootstrap.ts', import.meta.url).href
    );
    if (typeof compilerBootstrap.lockCompilerSecurityRealm !== 'function') {
      throw new TypeError(
        '@kovojs/compiler/internal/security-bootstrap must export lockCompilerSecurityRealm.',
      );
    }
    compilerBootstrap.lockCompilerSecurityRealm();
    return compilerBootstrap;
  })();
  return compilerReady;
}

/**
 * Establish compiler then server lockdown before importing Vite or an authored SSR graph.
 * Official repo scripts use this dedicated-process runner boundary (SPEC §6.6 rule 6).
 */
export function securityLockedViteRuntime() {
  runtimeReady ??= (async () => {
    await securityLockedCompilerRuntime();
    await import(new URL('../../packages/server/src/runtime-bootstrap.ts', import.meta.url).href);
    return import('vite-plus');
  })();
  return runtimeReady;
}

/** Create Vite only after the official script runner owns the irreversible lock transition. */
export async function createSecurityLockedViteServer(options) {
  const { createServer } = await securityLockedViteRuntime();
  return createServer(options);
}

/** Build with Vite only after compiler/server lockdown in this exact process. */
export async function buildWithSecurityLockedVite(options) {
  const { build } = await securityLockedViteRuntime();
  return build(options);
}

function registerTypeScriptSourceHooks() {
  if (typeScriptHooksRegistered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const candidate = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  typeScriptHooksRegistered = true;
}
