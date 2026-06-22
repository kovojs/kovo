/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Redo 2 icon (Lucide). https://lucide.dev/icons/redo-2 */
export function Redo2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 14 5-5-5-5"></path>
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"></path>
    </svg>
  );
}
