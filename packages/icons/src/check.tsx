/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Check icon (Lucide). https://lucide.dev/icons/check */
export function Check(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 6 9 17l-5-5"></path>
    </svg>
  );
}
