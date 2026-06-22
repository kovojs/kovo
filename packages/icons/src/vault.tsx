/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Vault icon (Lucide). https://lucide.dev/icons/vault */
export function Vault(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle>
      <path d="m7.9 7.9 2.7 2.7"></path>
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>
      <path d="m13.4 10.6 2.7-2.7"></path>
      <circle cx="7.5" cy="16.5" r=".5" fill="currentColor"></circle>
      <path d="m7.9 16.1 2.7-2.7"></path>
      <circle cx="16.5" cy="16.5" r=".5" fill="currentColor"></circle>
      <path d="m13.4 13.4 2.7 2.7"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
