/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Computer icon (Lucide). https://lucide.dev/icons/computer */
export function Computer(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="8" x="5" y="2" rx="2"></rect>
      <rect width="20" height="8" x="2" y="14" rx="2"></rect>
      <path d="M6 18h2"></path>
      <path d="M12 18h6"></path>
    </svg>
  );
}
