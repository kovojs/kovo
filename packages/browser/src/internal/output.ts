import { generatedDerive } from '../derive.js';

/** @internal Compiler-emitted derive ABI. */
export const derive = generatedDerive;
export type { DeriveDefinition } from '../derive.js';
export {
  kovoBoundAttributeValue,
  kovoEscapeHtml,
  kovoSafeUrl,
  kovoStyleProperty,
  kovoTrustedHtmlContent,
  isKovoTrustedUrl,
} from '../security-output.js';
