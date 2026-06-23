/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Arrow Left icon (Lucide). https://lucide.dev/icons/circle-arrow-left */
export function CircleArrowLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m12 8-4 4 4 4"></path>
      <path d="M16 12H8"></path>
    </svg>
  );
}
