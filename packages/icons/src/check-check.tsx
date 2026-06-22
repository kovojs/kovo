/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Check Check icon (Lucide). https://lucide.dev/icons/check-check */
export function CheckCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 6 7 17l-5-5"></path>
      <path d="m22 10-7.5 7.5L13 16"></path>
    </svg>
  );
}
