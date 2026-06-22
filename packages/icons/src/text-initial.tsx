/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Initial icon (Lucide). https://lucide.dev/icons/text-initial */
export function TextInitial(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 5h6"></path>
      <path d="M15 12h6"></path>
      <path d="M3 19h18"></path>
      <path d="m3 12 3.553-7.724a.5.5 0 0 1 .894 0L11 12"></path>
      <path d="M3.92 10h6.16"></path>
    </svg>
  );
}
