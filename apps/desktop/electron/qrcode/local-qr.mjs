// @ts-nocheck
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("./vendor/qrcode/lib/core/qrcode.js");
const SvgRenderer = require("./vendor/qrcode/lib/renderer/svg-tag.js");

export function createQrSvgDataUrl(text) {
  const cleanText = String(text ?? "").trim();
  if (!cleanText) throw new Error("QR payload is empty");
  const qr = QRCode.create(cleanText, { errorCorrectionLevel: "L" });
  const svg = SvgRenderer.render(qr, { margin: 4, width: 270 });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function getChannelRunSnapshotState(snapshot) {
  const status = String(snapshot?.status ?? "");
  const pendingApprovals = Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : [];
  return {
    status,
    pendingApprovals,
    hasPendingApprovals: pendingApprovals.length > 0,
    isCompletedWithOutput: status === "completed" && Boolean(snapshot?.output),
    isRunning: !status || status === "running",
    isTerminal: Boolean(status && status !== "running"),
  };
}

export const __test__ = {
  vendor: "qrcode@1.5.4",
  strategy: "shared-electron-local-vendor",
};
