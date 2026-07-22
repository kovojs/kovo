import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    deps: {
      // The standalone certificate checker is itself a reviewed artifact subject. Bundle its
      // parser so executing the authenticated dist tree cannot resolve mutable adjacent bytes.
      alwaysBundle: ['acorn'],
      onlyBundle: ['acorn'],
    },
  },
});
