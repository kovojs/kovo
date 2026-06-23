/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Horizontal icon (Lucide). https://lucide.dev/icons/move-horizontal */
export function MoveHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m18 8 4 4-4 4"></path>
      <path d="M2 12h20"></path>
      <path d="m6 8-4 4 4 4"></path>
    </svg>
  );
}
