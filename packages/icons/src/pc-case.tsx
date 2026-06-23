/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Pc Case icon (Lucide). https://lucide.dev/icons/pc-case */
export function PcCase(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="20" x="5" y="2" rx="2"></rect>
      <path d="M15 14h.01"></path>
      <path d="M9 6h6"></path>
      <path d="M9 10h6"></path>
    </svg>
  );
}
