/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Library Big icon (Lucide). https://lucide.dev/icons/library-big */
export function LibraryBig(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="8" height="18" x="3" y="3" rx="1"></rect>
      <path d="M7 3v18"></path>
      <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"></path>
    </svg>
  );
}
