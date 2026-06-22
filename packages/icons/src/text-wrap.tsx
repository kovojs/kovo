/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Wrap icon (Lucide). https://lucide.dev/icons/text-wrap */
export function TextWrap(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m16 16-3 3 3 3"></path>
      <path d="M3 12h14.5a1 1 0 0 1 0 7H13"></path>
      <path d="M3 19h6"></path>
      <path d="M3 5h18"></path>
    </svg>
  );
}
