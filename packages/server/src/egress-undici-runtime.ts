import { createRequire } from 'node:module';
import type { Dispatcher } from 'undici';

const requireUndici = createRequire(import.meta.url);
const undiciPackageName = 'undici';
const undici = requireUndici(undiciPackageName) as typeof import('undici');

export const Agent = undici.Agent;
export const getGlobalDispatcher = undici.getGlobalDispatcher;
export const setGlobalDispatcher = undici.setGlobalDispatcher;
export type UndiciAgentOptions = import('undici').Agent.Options;
export type { Dispatcher };
