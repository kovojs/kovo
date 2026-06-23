/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Chevron Up icon (Lucide). https://lucide.dev/icons/circle-chevron-up */
export function CircleChevronUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m8 14 4-4 4 4"></path>
    </svg>
  );
}
