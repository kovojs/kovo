// @ts-ignore: deepsec is installed in the standalone .deepsec workspace.
import { defineConfig } from 'deepsec/config';

export default defineConfig({
  projects: [
    { id: 'kovo', root: '..' },
    // <deepsec:projects-insert-above>
  ],
});
