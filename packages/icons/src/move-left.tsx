/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Left icon (Lucide). https://lucide.dev/icons/move-left */
export function MoveLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 8L2 12L6 16"></path>
      <path d="M2 12H22"></path>
    </svg>
  );
}
