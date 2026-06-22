/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Radio Receiver icon (Lucide). https://lucide.dev/icons/radio-receiver */
export function RadioReceiver(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 16v2"></path>
      <path d="M19 16v2"></path>
      <rect width="20" height="8" x="2" y="8" rx="2"></rect>
      <path d="M18 12h.01"></path>
    </svg>
  );
}
