/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Bluetooth Off icon (Lucide). https://lucide.dev/icons/bluetooth-off */
export function BluetoothOff(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 17-5 5V12l-5 5"></path>
      <path d="m2 2 20 20"></path>
      <path d="M14.5 9.5 17 7l-5-5v4.5"></path>
    </svg>
  );
}
