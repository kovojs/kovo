/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Up Left icon (Lucide). https://lucide.dev/icons/move-up-left */
export function MoveUpLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 11V5H11"></path>
      <path d="M5 5L19 19"></path>
    </svg>
  );
}
