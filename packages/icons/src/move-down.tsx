/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Down icon (Lucide). https://lucide.dev/icons/move-down */
export function MoveDown(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 18L12 22L16 18"></path>
      <path d="M12 2V22"></path>
    </svg>
  );
}
