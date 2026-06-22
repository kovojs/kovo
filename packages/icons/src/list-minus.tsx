/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Minus icon (Lucide). https://lucide.dev/icons/list-minus */
export function ListMinus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M11 12H3"></path>
      <path d="M16 19H3"></path>
      <path d="M21 12h-6"></path>
    </svg>
  );
}
