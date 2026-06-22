/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Globe Lock icon (Lucide). https://lucide.dev/icons/globe-lock */
export function GlobeLock(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15.686 15A14.5 14.5 0 0 1 12 22a14.5 14.5 0 0 1 0-20 10 10 0 1 0 9.542 13"></path>
      <path d="M2 12h8.5"></path>
      <path d="M20 6V4a2 2 0 1 0-4 0v2"></path>
      <rect width="8" height="5" x="14" y="6" rx="1"></rect>
    </svg>
  );
}
