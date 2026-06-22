/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Dice 2 icon (Lucide). https://lucide.dev/icons/dice-2 */
export function Dice2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
      <path d="M15 9h.01"></path>
      <path d="M9 15h.01"></path>
    </svg>
  );
}
