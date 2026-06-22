/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Rectangle Horizontal icon (Lucide). https://lucide.dev/icons/rectangle-horizontal */
export function RectangleHorizontal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="12" x="2" y="6" rx="2"></rect>
    </svg>
  );
}
