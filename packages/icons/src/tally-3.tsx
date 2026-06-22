/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tally 3 icon (Lucide). https://lucide.dev/icons/tally-3 */
export function Tally3(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 4v16"></path>
      <path d="M9 4v16"></path>
      <path d="M14 4v16"></path>
    </svg>
  );
}
