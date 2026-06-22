/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Pound Sterling icon (Lucide). https://lucide.dev/icons/circle-pound-sterling */
export function CirclePoundSterling(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M10 16V9.5a1 1 0 0 1 5 0"></path>
      <path d="M8 12h4"></path>
      <path d="M8 16h7"></path>
    </svg>
  );
}
