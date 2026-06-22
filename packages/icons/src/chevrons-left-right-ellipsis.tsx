/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Left Right Ellipsis icon (Lucide). https://lucide.dev/icons/chevrons-left-right-ellipsis */
export function ChevronsLeftRightEllipsis(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12h.01"></path>
      <path d="M16 12h.01"></path>
      <path d="m17 7 5 5-5 5"></path>
      <path d="m7 7-5 5 5 5"></path>
      <path d="M8 12h.01"></path>
    </svg>
  );
}
