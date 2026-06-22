/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Code icon (Lucide). https://lucide.dev/icons/code */
export function Code(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m16 18 6-6-6-6"></path>
      <path d="m8 6-6 6 6 6"></path>
    </svg>
  );
}
