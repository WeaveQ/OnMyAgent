import DefaultTheme from "vitepress/theme";
import { onMounted, watch, nextTick } from "vue";
import { useRoute } from "vitepress";
import "./custom.css";
import { installImageZoom, bindDocImageZoom, closeZoom } from "./image-zoom.js";

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();

    onMounted(() => {
      installImageZoom();
    });

    watch(
      () => route.path,
      () => {
        closeZoom();
        nextTick(() => bindDocImageZoom());
      },
    );
  },
};
