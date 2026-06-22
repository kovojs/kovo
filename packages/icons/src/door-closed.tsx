/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Door Closed icon (Lucide). https://lucide.dev/icons/door-closed */
export function DoorClosed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 12h.01"></path>
      <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"></path>
      <path d="M2 20h20"></path>
    </svg>
  );
}
