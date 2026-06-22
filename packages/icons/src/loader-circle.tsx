/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Loader Circle icon (Lucide). https://lucide.dev/icons/loader-circle */
export function LoaderCircle(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
  );
}
