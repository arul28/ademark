import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ademark.dev",
  // One page: its CSS goes inline, so the first paint does not wait for a stylesheet request.
  build: { inlineStylesheets: "always" },
});
