<script setup>
import { computed, onMounted, ref } from "vue";
import { useData } from "vitepress";
import { detectRecommendedPackage } from "./detect-download-target.mjs";

const OSS =
  "https://weaveq-onmyagent.oss-cn-hangzhou.aliyuncs.com/onmyagent/website-download";

const PACKAGES = [
  {
    id: "mac-arm64",
    href: `${OSS}/onmyagent-mac-arm64.dmg`,
    file: "onmyagent-mac-arm64.dmg",
    labelZh: "macOS Apple Silicon",
    labelEn: "macOS Apple Silicon",
  },
  {
    id: "mac-x64",
    href: `${OSS}/onmyagent-mac-x64.dmg`,
    file: "onmyagent-mac-x64.dmg",
    labelZh: "macOS Intel",
    labelEn: "macOS Intel",
  },
  {
    id: "win-x64",
    href: `${OSS}/onmyagent-win-x64.exe`,
    file: "onmyagent-win-x64.exe",
    labelZh: "Windows",
    labelEn: "Windows",
  },
];

const { lang } = useData();
const isZh = computed(() => !String(lang.value || "").toLowerCase().startsWith("en"));
const recommended = ref(null);

const copy = computed(() =>
  isZh.value
    ? { platform: "平台", download: "下载", badge: "推荐" }
    : { platform: "Platform", download: "Download", badge: "Recommended" },
);

onMounted(async () => {
  let architecture = "";
  let uaDataPlatform = "";
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const hints = await navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "platform",
      ]);
      architecture = String(hints.architecture ?? "");
      uaDataPlatform = String(hints.platform ?? "");
    }
  } catch {
    // UA-CH can throw when the permission is denied.
  }

  let webglRenderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && info) {
      webglRenderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "");
    }
  } catch {
    // WebGL is optional.
  }

  recommended.value = detectRecommendedPackage({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    uaDataPlatform,
    architecture,
    webglRenderer,
  });
});
</script>

<template>
  <div class="oma-dl">
    <table>
      <thead>
        <tr>
          <th>{{ copy.platform }}</th>
          <th>{{ copy.download }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="pkg in PACKAGES"
          :key="pkg.id"
          :class="{ 'is-recommended': recommended === pkg.id }"
        >
          <td>
            <span>{{ isZh ? pkg.labelZh : pkg.labelEn }}</span>
            <span v-if="recommended === pkg.id" class="oma-dl-badge">{{
              copy.badge
            }}</span>
          </td>
          <td>
            <a :href="pkg.href">{{ pkg.file }}</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.oma-dl {
  margin: 16px 0 24px;
  overflow-x: auto;
}

.oma-dl table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.oma-dl th,
.oma-dl td {
  border: 1px solid var(--vp-c-divider);
  padding: 10px 14px;
  text-align: left;
}

.oma-dl th {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-weight: 600;
}

.oma-dl tr.is-recommended td {
  background: var(--vp-c-brand-soft);
}

.oma-dl tr.is-recommended td:first-child {
  box-shadow: inset 3px 0 0 var(--vp-c-brand-1);
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.oma-dl tr.is-recommended a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.oma-dl-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  vertical-align: middle;
}
</style>
