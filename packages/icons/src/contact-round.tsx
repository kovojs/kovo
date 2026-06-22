/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Contact Round icon (Lucide). https://lucide.dev/icons/contact-round */
export function ContactRound(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 2v2"></path>
      <path d="M17.915 22a6 6 0 0 0-12 0"></path>
      <path d="M8 2v2"></path>
      <circle cx="12" cy="12" r="4"></circle>
      <rect x="3" y="4" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
