/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Arrow Up icon (Lucide). https://lucide.dev/icons/circle-arrow-up */
export function CircleArrowUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m16 12-4-4-4 4"></path>
      <path d="M12 16V8"></path>
    </svg>
  );
}
