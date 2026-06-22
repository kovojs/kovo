/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Up icon (Lucide). https://lucide.dev/icons/chevrons-up */
export function ChevronsUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 11-5-5-5 5"></path>
      <path d="m17 18-5-5-5 5"></path>
    </svg>
  );
}
