/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Chevron Down icon (Lucide). https://lucide.dev/icons/circle-chevron-down */
export function CircleChevronDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m16 10-4 4-4-4"></path>
    </svg>
  );
}
