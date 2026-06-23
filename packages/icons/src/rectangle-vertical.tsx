/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Rectangle Vertical icon (Lucide). https://lucide.dev/icons/rectangle-vertical */
export function RectangleVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="12" height="20" x="6" y="2" rx="2"></rect>
    </svg>
  );
}
