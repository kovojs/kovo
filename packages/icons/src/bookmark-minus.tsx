/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bookmark Minus icon (Lucide). https://lucide.dev/icons/bookmark-minus */
export function BookmarkMinus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 10H9"></path>
      <path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"></path>
    </svg>
  );
}
