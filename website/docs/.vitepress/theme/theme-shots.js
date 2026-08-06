/**
 * Theme-aware product screenshots.
 * Markdown keeps /images/foo.png; at runtime we show:
 *   light UI → /images/light/foo.png
 *   dark UI  → /images/dark/foo.png
 * Falls back to the original src if a themed asset 404s.
 */

const SHOT_ATTR = "data-oma-theme-shot";
let observerInstalled = false;
let themeObserver = null;

function productImageName(src) {
  if (!src) return null;
  try {
    const path = src.startsWith("http")
      ? new URL(src).pathname
      : src.split("?")[0];
    const m = path.match(/\/images\/(?:light\/|dark\/)?([^/]+\.png)$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function imagesBasePrefix(src) {
  const idx = src.indexOf("/images/");
  if (idx === -1) return null;
  return src.slice(0, idx + "/images/".length);
}

function themedUrl(src, theme) {
  const name = productImageName(src);
  const prefix = imagesBasePrefix(src);
  if (!name || !prefix) return src;
  return `${prefix}${theme}/${name}`;
}

function isDarkTheme() {
  return document.documentElement.classList.contains("dark");
}

function ensureDualShot(img) {
  if (img.closest(".oma-theme-shot") || img.getAttribute(SHOT_ATTR)) return;
  if (img.closest(".oma-zoom-overlay")) return;

  const original = img.getAttribute("src") || img.currentSrc || "";
  if (!productImageName(original)) return;

  const lightSrc = themedUrl(original, "light");
  const darkSrc = themedUrl(original, "dark");

  const wrap = document.createElement("span");
  wrap.className = "oma-theme-shot";
  wrap.setAttribute(SHOT_ATTR, "1");

  const light = img.cloneNode(false);
  light.removeAttribute("data-oma-zoom-bound");
  light.classList.add("oma-shot-light");
  light.setAttribute("src", lightSrc);
  light.setAttribute("data-oma-shot-theme", "light");
  light.onerror = () => {
    light.onerror = null;
    light.src = original;
  };

  const dark = img.cloneNode(false);
  dark.removeAttribute("data-oma-zoom-bound");
  dark.classList.add("oma-shot-dark");
  dark.setAttribute("src", darkSrc);
  dark.setAttribute("data-oma-shot-theme", "dark");
  dark.onerror = () => {
    dark.onerror = null;
    dark.src = original;
  };

  const alt = img.getAttribute("alt") || "";
  light.setAttribute("alt", alt);
  dark.setAttribute("alt", alt);

  const parent = img.parentNode;
  if (!parent) return;
  parent.insertBefore(wrap, img);
  wrap.appendChild(light);
  wrap.appendChild(dark);
  img.remove();
}

function enhanceDocShots(root = document) {
  if (typeof window === "undefined") return;
  const imgs = root.querySelectorAll(
    '.vp-doc img[src*="/images/"]:not([data-oma-shot-theme])',
  );
  imgs.forEach((img) => {
    if (img.closest("a")) return;
    ensureDualShot(img);
  });
}

function visibleShotSrc(img) {
  const wrap = img.closest(".oma-theme-shot");
  if (!wrap) return img.currentSrc || img.src;
  const theme = isDarkTheme() ? "dark" : "light";
  const themed = wrap.querySelector(`img[data-oma-shot-theme="${theme}"]`);
  return (themed && (themed.currentSrc || themed.src)) || img.currentSrc || img.src;
}

function installThemeShotObserver() {
  if (themeObserver || typeof window === "undefined") return;
  themeObserver = new MutationObserver(() => {
    // class toggle on <html> — no src rewrite needed (CSS shows the right img)
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/** Bind dual light/dark shots; safe on every route change. */
export function bindThemeShots() {
  if (typeof window === "undefined") return;
  enhanceDocShots();
  installThemeShotObserver();
}

export function installThemeShots() {
  if (typeof window === "undefined") return;
  if (!observerInstalled) {
    observerInstalled = true;
    const mo = new MutationObserver(() => enhanceDocShots());
    mo.observe(document.body, { childList: true, subtree: true });
  }
  bindThemeShots();
}

export { visibleShotSrc, isDarkTheme, productImageName };
