/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** X icon (Lucide). https://lucide.dev/icons/x */
export function X(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    </svg>
  );
}
