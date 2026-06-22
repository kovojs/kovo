/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Chevron Left icon (Lucide). https://lucide.dev/icons/circle-chevron-left */
export function CircleChevronLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m14 16-4-4 4-4"></path>
    </svg>
  );
}
