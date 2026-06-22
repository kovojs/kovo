/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bluetooth Searching icon (Lucide). https://lucide.dev/icons/bluetooth-searching */
export function BluetoothSearching(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 7 10 10-5 5V2l5 5L7 17"></path>
      <path d="M20.83 14.83a4 4 0 0 0 0-5.66"></path>
      <path d="M18 12h.01"></path>
    </svg>
  );
}
