// @ts-nocheck -- migration input intentionally imports a removed public symbol.
import { installKovoLoader } from '@kovojs/browser/client';

installKovoLoader({
  importModule: (url) => import(url),
  root: document,
});
