import DefaultTheme from "vitepress/theme";
import { onMounted, watch, nextTick } from "vue";
import { useRoute } from "vitepress";
import "./custom.css";
import { installImageZoom, bindDocImageZoom, closeZoom } from "./image-zoom.js";
import { installThemeShots, bindThemeShots } from "./theme-shots.js";
import DownloadPackages from "./DownloadPackages.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DownloadPackages", DownloadPackages);
  },
  setup() {
    const route = useRoute();

    onMounted(() => {
      installThemeShots();
      installImageZoom();
    });

    watch(
      () => route.path,
      () => {
        closeZoom();
        nextTick(() => {
          bindThemeShots();
          bindDocImageZoom();
        });
      },
    );
  },
};
