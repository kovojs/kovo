/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Decimals Arrow Left icon (Lucide). https://lucide.dev/icons/decimals-arrow-left */
export function DecimalsArrowLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m13 21-3-3 3-3"></path>
      <path d="M20 18H10"></path>
      <path d="M3 11h.01"></path>
      <rect x="6" y="3" width="5" height="8" rx="2.5"></rect>
    </svg>
  );
}
