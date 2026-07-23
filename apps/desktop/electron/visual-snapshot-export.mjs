const MAX_CAPTURE_EDGE = 8_192;

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

export function normalizeVisualCaptureRect(input, bounds) {
  const boundsWidth = Math.max(1, finiteInteger(bounds?.width) ?? 1);
  const boundsHeight = Math.max(1, finiteInteger(bounds?.height) ?? 1);
  const rawX = finiteInteger(input?.x);
  const rawY = finiteInteger(input?.y);
  const rawWidth = finiteInteger(input?.width);
  const rawHeight = finiteInteger(input?.height);
  if (rawX === null || rawY === null || rawWidth === null || rawHeight === null) {
    throw new Error("Visual export rectangle must contain finite coordinates.");
  }
  const x = Math.min(Math.max(rawX, 0), boundsWidth - 1);
  const y = Math.min(Math.max(rawY, 0), boundsHeight - 1);
  const width = Math.min(Math.max(rawWidth, 1), boundsWidth - x, MAX_CAPTURE_EDGE);
  const height = Math.min(Math.max(rawHeight, 1), boundsHeight - y, MAX_CAPTURE_EDGE);
  return { x, y, width, height };
}

function saveDialogOptions(format, defaultPath) {
  return {
    title: format === "png" ? "Export preview image" : "Export preview PDF",
    defaultPath,
    filters: format === "png"
      ? [{ name: "PNG image", extensions: ["png"] }]
      : [{ name: "PDF document", extensions: ["pdf"] }],
  };
}

export async function createVisualSnapshotPdf({ BrowserWindow, image, rect }) {
  const printWindow = new BrowserWindow({
    show: false,
    width: Math.min(Math.max(rect.width, 320), 1_600),
    height: Math.min(Math.max(rect.height, 240), 1_200),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const orientation = rect.width > rect.height ? "landscape" : "portrait";
    const document = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 ${orientation};margin:0}html,body{width:100%;height:100%;margin:0;background:#fff}body{display:flex;align-items:center;justify-content:center}img{display:block;max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img alt="Preview" src="${image.toDataURL()}"></body></html>`;
    await printWindow.loadURL(
      `data:text/html;base64,${Buffer.from(document, "utf8").toString("base64")}`,
    );
    return await printWindow.webContents.printToPDF({
      printBackground: true,
      landscape: orientation === "landscape",
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

export async function exportVisualSnapshot(input, deps) {
  const format = input?.format;
  if (format !== "png" && format !== "pdf") {
    throw new Error("Visual export format must be png or pdf.");
  }
  const sourceWindow = deps.sourceWindow;
  if (!sourceWindow || sourceWindow.isDestroyed?.()) {
    throw new Error("The source window is unavailable.");
  }
  const result = await deps.dialog.showSaveDialog(
    sourceWindow,
    saveDialogOptions(format, input.defaultPath),
  );
  if (result.canceled || !result.filePath) return { status: "cancelled", path: null };

  const rect = normalizeVisualCaptureRect(input.rect, sourceWindow.getContentBounds());
  const image = await sourceWindow.webContents.capturePage(rect);
  if (image.isEmpty()) throw new Error("The preview capture was empty.");
  const bytes = format === "png"
    ? image.toPNG()
    : await deps.createPdf(image, rect);
  await deps.writeFile(result.filePath, bytes);
  return { status: "saved", path: result.filePath };
}
