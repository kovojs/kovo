import { defineConfig } from 'deepsec/config';

export default defineConfig({
  projects: [
    { id: 'kovo', root: '..' },
    // <deepsec:projects-insert-above>
  ],
});
