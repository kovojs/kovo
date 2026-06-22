/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Dice 3 icon (Lucide). https://lucide.dev/icons/dice-3 */
export function Dice3(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
      <path d="M16 8h.01"></path>
      <path d="M12 12h.01"></path>
      <path d="M8 16h.01"></path>
    </svg>
  );
}
