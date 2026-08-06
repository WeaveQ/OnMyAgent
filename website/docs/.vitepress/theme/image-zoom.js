/**
 * Click-to-zoom lightbox for doc screenshots (no extra dependency).
 */

const OVERLAY_ID = "oma-image-zoom-overlay";
let installed = false;

function ensureOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.className = "oma-zoom-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "图片预览");
  el.innerHTML = `
    <button type="button" class="oma-zoom-close" aria-label="关闭">×</button>
    <img class="oma-zoom-img" alt="" />
    <p class="oma-zoom-hint">点击空白处或按 Esc 关闭 · 滚轮可缩小浏览器缩放</p>
  `;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.classList.contains("oma-zoom-close")) {
      closeZoom();
    }
  });
  el.querySelector(".oma-zoom-img")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return el;
}

function openZoom(src, alt) {
  const overlay = ensureOverlay();
  const img = overlay.querySelector(".oma-zoom-img");
  if (img) {
    img.src = src;
    img.alt = alt || "";
  }
  overlay.classList.add("is-open");
  document.body.classList.add("oma-zoom-open");
  document.documentElement.style.overflow = "hidden";
}

function closeZoom() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  overlay.classList.remove("is-open");
  document.body.classList.remove("oma-zoom-open");
  document.documentElement.style.overflow = "";
  const img = overlay.querySelector(".oma-zoom-img");
  if (img) img.removeAttribute("src");
}

function bindImages(root = document) {
  const imgs = root.querySelectorAll(".vp-doc img:not([data-oma-zoom-bound])");
  imgs.forEach((img) => {
    if (img.closest("a")) return;
    img.setAttribute("data-oma-zoom-bound", "1");
    img.classList.add("oma-zoomable");
    img.setAttribute("title", "点击放大");
    img.addEventListener("click", (e) => {
      e.preventDefault();
      const src = img.currentSrc || img.src;
      if (!src) return;
      openZoom(src, img.alt || "");
    });
  });
}

/** Bind zoom handlers; safe to call on every route change. */
export function bindDocImageZoom() {
  if (typeof window === "undefined") return;
  bindImages();
}

/** One-time install of overlay + keyboard + observer. */
export function installImageZoom() {
  if (typeof window === "undefined" || installed) {
    bindDocImageZoom();
    return;
  }
  installed = true;

  ensureOverlay();
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeZoom();
  });

  const mo = new MutationObserver(() => bindDocImageZoom());
  mo.observe(document.body, { childList: true, subtree: true });
  bindDocImageZoom();
}

export { closeZoom };
