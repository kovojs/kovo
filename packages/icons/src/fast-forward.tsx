/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Fast Forward icon (Lucide). https://lucide.dev/icons/fast-forward */
export function FastForward(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 12 18z"></path>
      <path d="M2 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 2 18z"></path>
    </svg>
  );
}
