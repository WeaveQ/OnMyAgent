import {
  createShapeId,
  type Editor,
  type TLCreateShapePartial,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  toRichText,
} from "tldraw";

import { createCanvasCommandResult, validateCanvasCommands, type ValidatedCanvasCommand } from "./commands";
import { templateById } from "./templates";
import type {
  CanvasCommand,
  CanvasCommandResult,
  CanvasShapeColor,
  CanvasShapeInput,
  CanvasShapeKind,
} from "./types";

function toShapeId(id: string) {
  return createShapeId(id);
}

function currentShapeIds(editor: Editor) {
  const ids = new Set<string>();
  for (const id of editor.getCurrentPageShapeIds()) {
    ids.add(id.replace(/^shape:/, ""));
  }
  return ids;
}

function shapeIds(ids: string[]) {
  return ids.map(toShapeId);
}

function geoKind(kind: CanvasShapeKind) {
  if (kind === "ellipse") return "ellipse";
  if (kind === "diamond") return "diamond";
  return "rectangle";
}

function shapeFill(color: CanvasShapeColor | undefined) {
  if (!color || color === "black" || color === "grey") return "none";
  return "semi";
}

export function canvasShapeToTldrawShape(shape: CanvasShapeInput): TLCreateShapePartial {
  const width = shape.width ?? 180;
  const height = shape.height ?? 180;
  const color = shape.color ?? "black";
  const richText = toRichText(shape.text ?? "");

  if (shape.kind === "note") {
    return {
      id: toShapeId(shape.id),
      type: "note",
      x: shape.x,
      y: shape.y,
      props: {
        color,
        richText,
        size: "m",
      },
    } satisfies TLCreateShapePartial;
  }

  if (shape.kind === "text") {
    return {
      id: toShapeId(shape.id),
      type: "text",
      x: shape.x,
      y: shape.y,
      props: {
        color,
        richText,
        size: "m",
        w: width,
      },
    } satisfies TLCreateShapePartial;
  }

  if (shape.kind === "arrow") {
    return {
      id: toShapeId(shape.id),
      type: "arrow",
      x: shape.x,
      y: shape.y,
      props: {
        color,
        end: {
          x: width,
          y: height,
        },
        richText,
      },
    } satisfies TLCreateShapePartial;
  }

  return {
    id: toShapeId(shape.id),
    type: "geo",
    x: shape.x,
    y: shape.y,
    props: {
      color,
      fill: shapeFill(shape.color),
      geo: geoKind(shape.kind),
      h: height,
      richText,
      w: width,
    },
  } satisfies TLCreateShapePartial;
}

function shapeToUpdatePartial(shape: CanvasShapeInput): TLShapePartial {
  return {
    ...canvasShapeToTldrawShape(shape),
    id: toShapeId(shape.id),
  };
}

function resizePartials(editor: Editor, ids: TLShapeId[], width: number, height: number) {
  const partials: TLShapePartial[] = [];
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    if (shape.type === "geo" || shape.type === "image") {
      partials.push({ id, type: shape.type, props: { w: width, h: height } });
    } else if (shape.type === "text") {
      partials.push({ id, type: "text", props: { w: width } });
    }
  }
  return partials;
}

function stylePartials(editor: Editor, ids: TLShapeId[], color: CanvasShapeColor) {
  const partials: TLShapePartial[] = [];
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    if (
      shape.type === "geo" ||
      shape.type === "note" ||
      shape.type === "text" ||
      shape.type === "arrow"
    ) {
      partials.push({ id, type: shape.type, props: { color } });
    }
  }
  return partials;
}

function createConnection(editor: Editor, command: Extract<ValidatedCanvasCommand, { type: "connect" }>) {
  const from = editor.getShape(toShapeId(command.fromId));
  const to = editor.getShape(toShapeId(command.toId));
  if (!from || !to) return;
  const fromBounds = editor.getShapePageBounds(from);
  const toBounds = editor.getShapePageBounds(to);
  if (!fromBounds || !toBounds) return;
  editor.createShape({
    id: toShapeId(command.id),
    type: "arrow",
    x: fromBounds.maxX,
    y: fromBounds.midY,
    props: {
      end: {
        x: toBounds.minX - fromBounds.maxX,
        y: toBounds.midY - fromBounds.midY,
      },
      richText: toRichText(command.text ?? ""),
    },
  });
}

function insertImageShape(command: Extract<ValidatedCanvasCommand, { type: "insertImage" }>) {
  return {
    id: toShapeId(command.asset.id),
    type: "image",
    x: command.x,
    y: command.y,
    props: {
      altText: command.asset.name,
      assetId: null,
      crop: null,
      flipX: false,
      flipY: false,
      h: command.height,
      playing: true,
      url: command.asset.dataUrl ?? "",
      w: command.width,
    },
  } satisfies TLCreateShapePartial;
}

function applyTemplate(editor: Editor, templateId: Extract<ValidatedCanvasCommand, { type: "template" }>["templateId"]) {
  const template = templateById(templateId);
  if (!template) return;
  const existing = Array.from(editor.getCurrentPageShapeIds());
  if (existing.length > 0) {
    editor.deleteShapes(existing);
  }
  if (template.shapes.length > 0) {
    editor.createShapes(template.shapes.map(canvasShapeToTldrawShape));
    editor.zoomToFit();
  }
}

function applyCommand(editor: Editor, command: ValidatedCanvasCommand) {
  if (command.type === "create") {
    editor.createShapes(command.shapes.map(canvasShapeToTldrawShape));
    return;
  }
  if (command.type === "update") {
    editor.updateShapes(command.shapes.map(shapeToUpdatePartial));
    return;
  }
  if (command.type === "delete") {
    editor.deleteShapes(shapeIds(command.ids));
    return;
  }
  if (command.type === "move") {
    editor.nudgeShapes(shapeIds(command.ids), { x: command.dx, y: command.dy });
    return;
  }
  if (command.type === "resize") {
    editor.updateShapes(resizePartials(editor, shapeIds(command.ids), command.width, command.height));
    return;
  }
  if (command.type === "connect") {
    createConnection(editor, command);
    return;
  }
  if (command.type === "group") {
    editor.groupShapes(shapeIds(command.ids));
    return;
  }
  if (command.type === "template") {
    applyTemplate(editor, command.templateId);
    return;
  }
  if (command.type === "arrange") {
    editor.distributeShapes(shapeIds(command.ids), command.direction);
    return;
  }
  if (command.type === "style") {
    editor.updateShapes(stylePartials(editor, shapeIds(command.ids), command.color));
    return;
  }
  editor.createShape(insertImageShape(command));
}

export function runCanvasCommands(editor: Editor, commands: CanvasCommand[]): CanvasCommandResult {
  const validation = validateCanvasCommands(commands, currentShapeIds(editor));
  const checkpointIds: string[] = [];
  let applied = 0;

  for (const command of validation.commands) {
    const checkpointId = editor.markHistoryStoppingPoint(`canvas-${command.type}`);
    checkpointIds.push(checkpointId);
    applyCommand(editor, command);
    applied += 1;
  }

  return createCanvasCommandResult(applied, checkpointIds, validation.errors);
}

export function getCanvasContextSummary(editor: Editor) {
  const shapes: TLShape[] = editor.getCurrentPageShapes();
  return {
    shapeCount: shapes.length,
    selectedShapeIds: editor.getSelectedShapeIds().map((id) => id.replace(/^shape:/, "")),
    text: shapes
      .map((shape) => {
        if ("richText" in shape.props) {
          return JSON.stringify(shape.props.richText);
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 50),
  };
}
