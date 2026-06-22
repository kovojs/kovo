/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Banknote X icon (Lucide). https://lucide.dev/icons/banknote-x */
export function BanknoteX(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"></path>
      <path d="m17 17 5 5"></path>
      <path d="M18 12h.01"></path>
      <path d="m22 17-5 5"></path>
      <path d="M6 12h.01"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
