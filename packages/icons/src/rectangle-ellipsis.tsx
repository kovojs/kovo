/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Rectangle Ellipsis icon (Lucide). https://lucide.dev/icons/rectangle-ellipsis */
export function RectangleEllipsis(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="12" x="2" y="6" rx="2"></rect>
      <path d="M12 12h.01"></path>
      <path d="M17 12h.01"></path>
      <path d="M7 12h.01"></path>
    </svg>
  );
}
