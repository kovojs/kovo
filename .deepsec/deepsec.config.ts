import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "jiso", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
