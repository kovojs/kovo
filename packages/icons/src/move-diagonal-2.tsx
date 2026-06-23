/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Diagonal 2 icon (Lucide). https://lucide.dev/icons/move-diagonal-2 */
export function MoveDiagonal2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 13v6h-6"></path>
      <path d="M5 11V5h6"></path>
      <path d="m5 5 14 14"></path>
    </svg>
  );
}
