import { compileSJS } from "@sjs/compiler";

export function sjs() {
  return {
    name: "vite-plugin-sjs",
    transform(code, id) {
      if (!id.endsWith(".sjs")) return;
      return compileSJS(code, id);
    }
  };
}