import type { TLEditorSnapshot } from "tldraw";

export const CANVAS_SNAPSHOT_VERSION = 1;
export const CANVAS_MAX_COMMANDS_PER_RUN = 24;
export const CANVAS_MAX_TEXT_LENGTH = 2_000;
export const CANVAS_MAX_DIMENSION = 4_000;

export type CanvasSurfaceKind = "assistant-office" | "assistant-code" | "expert";

export type CanvasSessionKey = {
  workspaceId: string;
  sessionId: string;
  surface: CanvasSurfaceKind;
};

export type CanvasAssetRef = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  createdAt: number;
};

export type CanvasTemplateId =
  | "blank"
  | "flowchart"
  | "taskBreakdown"
  | "architecture"
  | "meeting"
  | "expertAnalysis";

export type CanvasExportFormat = "png" | "json";

export type CanvasSnapshot = {
  version: typeof CANVAS_SNAPSHOT_VERSION;
  key: CanvasSessionKey;
  document: TLEditorSnapshot | null;
  templateId: CanvasTemplateId;
  assets: CanvasAssetRef[];
  createdAt: number;
  updatedAt: number;
};

export type CanvasShapeKind = "note" | "text" | "rectangle" | "ellipse" | "diamond" | "arrow";

export type CanvasShapeInput = {
  id: string;
  kind: CanvasShapeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: CanvasShapeColor;
  targetId?: string;
};

export type CanvasShapeColor =
  | "black"
  | "blue"
  | "green"
  | "grey"
  | "orange"
  | "red"
  | "violet"
  | "yellow";

export type CanvasCreateCommand = {
  type: "create";
  shapes: CanvasShapeInput[];
};

export type CanvasUpdateCommand = {
  type: "update";
  shapes: Array<CanvasShapeInput & { id: string }>;
};

export type CanvasDeleteCommand = {
  type: "delete";
  ids: string[];
};

export type CanvasMoveCommand = {
  type: "move";
  ids: string[];
  dx: number;
  dy: number;
};

export type CanvasResizeCommand = {
  type: "resize";
  ids: string[];
  width: number;
  height: number;
};

export type CanvasConnectCommand = {
  type: "connect";
  fromId: string;
  toId: string;
  id: string;
  text?: string;
};

export type CanvasGroupCommand = {
  type: "group";
  ids: string[];
};

export type CanvasTemplateCommand = {
  type: "template";
  templateId: CanvasTemplateId;
};

export type CanvasArrangeCommand = {
  type: "arrange";
  ids: string[];
  direction: "horizontal" | "vertical";
};

export type CanvasStyleCommand = {
  type: "style";
  ids: string[];
  color: CanvasShapeColor;
};

export type CanvasInsertImageCommand = {
  type: "insertImage";
  asset: CanvasAssetRef;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasCommand =
  | CanvasCreateCommand
  | CanvasUpdateCommand
  | CanvasDeleteCommand
  | CanvasMoveCommand
  | CanvasResizeCommand
  | CanvasConnectCommand
  | CanvasGroupCommand
  | CanvasTemplateCommand
  | CanvasArrangeCommand
  | CanvasStyleCommand
  | CanvasInsertImageCommand;

export type CanvasCommandResult = {
  ok: boolean;
  applied: number;
  checkpointIds: string[];
  errors: string[];
};

export type CanvasContextSummary = {
  key: CanvasSessionKey;
  shapeCount: number;
  selectedShapeIds: string[];
  text: string[];
  screenshotDataUrl: string | null;
};
