/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move Up icon (Lucide). https://lucide.dev/icons/move-up */
export function MoveUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 6L12 2L16 6"></path>
      <path d="M12 2V22"></path>
    </svg>
  );
}
