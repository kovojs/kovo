/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Dice 1 icon (Lucide). https://lucide.dev/icons/dice-1 */
export function Dice1(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
      <path d="M12 12h.01"></path>
    </svg>
  );
}
