/** Generic electron-updater feed on Aliyun OSS (no trailing slash). */
export const DEFAULT_UPDATE_FEED_URL =
  "https://weaveq-onmyagent.oss-cn-hangzhou.aliyuncs.com/onmyagent";

export function normalizeFeedUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export function resolveUpdateFeedUrl(env = process.env) {
  return normalizeFeedUrl(env.ONMYAGENT_UPDATE_FEED_URL) || DEFAULT_UPDATE_FEED_URL;
}

export function updaterManifestName(platform) {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "linux") return "latest-linux.yml";
  return "latest.yml";
}

export function resolveUpdaterManifestUrl(platform, env = process.env) {
  const override = normalizeFeedUrl(env.ONMYAGENT_UPDATE_API);
  if (override) return override;
  return `${resolveUpdateFeedUrl(env)}/${updaterManifestName(platform)}`;
}

export function resolveFeedArtifactUrl(feedUrl, pathOrUrl) {
  const relative = String(pathOrUrl ?? "").trim();
  if (!relative) return "";
  if (/^https?:\/\//i.test(relative)) return relative;
  const base = normalizeFeedUrl(feedUrl);
  if (!base) return relative;
  return new URL(relative, `${base}/`).toString();
}

function unquoteYamlScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseUpdaterManifest(raw) {
  const files = [];
  let version = "";
  let releaseDate = "";
  let currentFile = null;

  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const fileStart = line.match(/^\s*-\s+url:\s*(.*?)\s*$/);
    if (fileStart) {
      currentFile = { url: unquoteYamlScalar(fileStart[1]) };
      files.push(currentFile);
      continue;
    }
    const fileProp = line.match(/^\s+(sha512|size):\s*(.*?)\s*$/);
    if (fileProp && currentFile) {
      currentFile[fileProp[1]] = unquoteYamlScalar(fileProp[2]);
      continue;
    }
    const top = line.match(/^(version|releaseDate):\s*(.*?)\s*$/);
    if (top) {
      currentFile = null;
      const value = unquoteYamlScalar(top[2]);
      if (top[1] === "version") version = value;
      else releaseDate = value;
    }
  }

  return { version, releaseDate, files };
}

export function pickFallbackArtifactUrl(manifest, platform, arch = process.arch) {
  const urls = Array.isArray(manifest?.files)
    ? manifest.files.map((file) => String(file?.url ?? "")).filter(Boolean)
    : [];
  if (platform === "darwin") {
    const archToken = arch === "arm64" ? "arm64" : "x64";
    const zip = urls.find(
      (url) => url.includes(`mac-${archToken}`) && /\.zip$/i.test(url),
    );
    if (zip) return zip;
    const dmg = urls.find(
      (url) => url.includes(`mac-${archToken}`) && /\.dmg$/i.test(url),
    );
    if (dmg) return dmg;
    const anyZip = urls.find((url) => /\.zip$/i.test(url));
    if (anyZip) return anyZip;
  }
  if (platform === "win32") {
    const exe = urls.find((url) => /\.exe$/i.test(url));
    if (exe) return exe;
  }
  return urls[0] ?? "";
}
