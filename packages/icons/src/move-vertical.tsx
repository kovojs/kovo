/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Vertical icon (Lucide). https://lucide.dev/icons/move-vertical */
export function MoveVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v20"></path>
      <path d="m8 18 4 4 4-4"></path>
      <path d="m8 6 4-4 4 4"></path>
    </svg>
  );
}
