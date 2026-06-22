/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Ellipsis icon (Lucide). https://lucide.dev/icons/circle-ellipsis */
export function CircleEllipsis(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M17 12h.01"></path>
      <path d="M12 12h.01"></path>
      <path d="M7 12h.01"></path>
    </svg>
  );
}
