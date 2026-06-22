/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bluetooth icon (Lucide). https://lucide.dev/icons/bluetooth */
export function Bluetooth(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 7 10 10-5 5V2l5 5L7 17"></path>
    </svg>
  );
}
