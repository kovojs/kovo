/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Flip Horizontal 2 icon (Lucide). https://lucide.dev/icons/flip-horizontal-2 */
export function FlipHorizontal2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 7 5 5-5 5V7"></path>
      <path d="m21 7-5 5 5 5V7"></path>
      <path d="M12 20v2"></path>
      <path d="M12 14v2"></path>
      <path d="M12 8v2"></path>
      <path d="M12 2v2"></path>
    </svg>
  );
}
