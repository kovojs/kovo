/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Arrow Right icon (Lucide). https://lucide.dev/icons/circle-arrow-right */
export function CircleArrowRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m12 16 4-4-4-4"></path>
      <path d="M8 12h8"></path>
    </svg>
  );
}
