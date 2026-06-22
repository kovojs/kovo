/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Small icon (Lucide). https://lucide.dev/icons/circle-small */
export function CircleSmall(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="6"></circle>
    </svg>
  );
}
