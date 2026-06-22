/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mail icon (Lucide). https://lucide.dev/icons/mail */
export function Mail(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path>
      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
    </svg>
  );
}
