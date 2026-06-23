/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Decimals Arrow Right icon (Lucide). https://lucide.dev/icons/decimals-arrow-right */
export function DecimalsArrowRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 18h10"></path>
      <path d="m17 21 3-3-3-3"></path>
      <path d="M3 11h.01"></path>
      <rect x="15" y="3" width="5" height="8" rx="2.5"></rect>
      <rect x="6" y="3" width="5" height="8" rx="2.5"></rect>
    </svg>
  );
}
