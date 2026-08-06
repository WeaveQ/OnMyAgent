import DefaultTheme from "vitepress/theme";
import { onMounted, watch, nextTick } from "vue";
import { useRoute } from "vitepress";
import "./custom.css";
import { installImageZoom, bindDocImageZoom, closeZoom } from "./image-zoom.js";
import { installThemeShots, bindThemeShots } from "./theme-shots.js";

export default {
  extends: DefaultTheme,
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
