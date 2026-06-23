/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Banknote Check icon (Lucide). https://lucide.dev/icons/banknote-check */
export function BanknoteCheck(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11.748 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4.875"></path>
      <path d="m16 19 2 2 4-4"></path>
      <path d="M18 12h.01"></path>
      <path d="M6 12h.01"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
