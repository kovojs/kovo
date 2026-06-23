/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Chevron Right icon (Lucide). https://lucide.dev/icons/circle-chevron-right */
export function CircleChevronRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m10 8 4 4-4 4"></path>
    </svg>
  );
}
