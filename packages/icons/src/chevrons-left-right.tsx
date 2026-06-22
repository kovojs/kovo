/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Left Right icon (Lucide). https://lucide.dev/icons/chevrons-left-right */
export function ChevronsLeftRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 7-5 5 5 5"></path>
      <path d="m15 7 5 5-5 5"></path>
    </svg>
  );
}
