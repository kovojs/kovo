/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Annoyed icon (Lucide). https://lucide.dev/icons/annoyed */
export function Annoyed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M8 15h8"></path>
      <path d="M8 9h2"></path>
      <path d="M14 9h2"></path>
    </svg>
  );
}
