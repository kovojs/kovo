/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Message Square Diff icon (Lucide). https://lucide.dev/icons/message-square-diff */
export function MessageSquareDiff(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"></path>
      <path d="M10 15h4"></path>
      <path d="M10 9h4"></path>
      <path d="M12 7v4"></path>
    </svg>
  );
}
