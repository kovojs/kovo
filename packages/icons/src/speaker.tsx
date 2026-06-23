/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Speaker icon (Lucide). https://lucide.dev/icons/speaker */
export function Speaker(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="16" height="20" x="4" y="2" rx="2"></rect>
      <path d="M12 6h.01"></path>
      <circle cx="12" cy="14" r="4"></circle>
      <path d="M12 14h.01"></path>
    </svg>
  );
}
