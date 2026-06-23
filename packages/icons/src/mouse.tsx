/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Mouse icon (Lucide). https://lucide.dev/icons/mouse */
export function Mouse(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="5" y="2" width="14" height="20" rx="7"></rect>
      <path d="M12 6v4"></path>
    </svg>
  );
}
