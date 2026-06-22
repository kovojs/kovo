/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Washing Machine icon (Lucide). https://lucide.dev/icons/washing-machine */
export function WashingMachine(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 6h3"></path>
      <path d="M17 6h.01"></path>
      <rect width="18" height="20" x="3" y="2" rx="2"></rect>
      <circle cx="12" cy="13" r="5"></circle>
      <path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"></path>
    </svg>
  );
}
