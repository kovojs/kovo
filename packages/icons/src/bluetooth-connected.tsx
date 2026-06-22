/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bluetooth Connected icon (Lucide). https://lucide.dev/icons/bluetooth-connected */
export function BluetoothConnected(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 7 10 10-5 5V2l5 5L7 17"></path>
      <line x1="18" x2="21" y1="12" y2="12"></line>
      <line x1="3" x2="6" y1="12" y2="12"></line>
    </svg>
  );
}
