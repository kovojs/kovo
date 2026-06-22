/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Baggage Claim icon (Lucide). https://lucide.dev/icons/baggage-claim */
export function BaggageClaim(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 18H6a2 2 0 0 1-2-2V7a2 2 0 0 0-2-2"></path>
      <path d="M17 14V4a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v10"></path>
      <rect width="13" height="8" x="8" y="6" rx="1"></rect>
      <circle cx="18" cy="20" r="2"></circle>
      <circle cx="9" cy="20" r="2"></circle>
    </svg>
  );
}
