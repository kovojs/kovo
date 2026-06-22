/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Scan Qr Code icon (Lucide). https://lucide.dev/icons/scan-qr-code */
export function ScanQrCode(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 12v4a1 1 0 0 1-1 1h-4"></path>
      <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
      <path d="M17 8V7"></path>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
      <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
      <path d="M7 17h.01"></path>
      <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
      <rect x="7" y="7" width="5" height="5" rx="1"></rect>
    </svg>
  );
}
