/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Log In icon (Lucide). https://lucide.dev/icons/log-in */
export function LogIn(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 17 5-5-5-5"></path>
      <path d="M15 12H3"></path>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
    </svg>
  );
}
