import {
  CANVAS_MAX_COMMANDS_PER_RUN,
  CANVAS_MAX_DIMENSION,
  CANVAS_MAX_TEXT_LENGTH,
  type CanvasArrangeCommand,
  type CanvasCommand,
  type CanvasCommandResult,
  type CanvasConnectCommand,
  type CanvasCreateCommand,
  type CanvasDeleteCommand,
  type CanvasGroupCommand,
  type CanvasInsertImageCommand,
  type CanvasMoveCommand,
  type CanvasResizeCommand,
  type CanvasShapeColor,
  type CanvasShapeInput,
  type CanvasStyleCommand,
  type CanvasTemplateCommand,
  type CanvasUpdateCommand,
} from "./types";

const DEFAULT_SHAPE_SIZE = 180;
const MIN_SHAPE_SIZE = 16;
const MAX_COORDINATE = 100_000;
const MAX_DELETE_RATIO = 0.8;
const VALID_COLORS = new Set<CanvasShapeColor>([
  "black",
  "blue",
  "green",
  "grey",
  "orange",
  "red",
  "violet",
  "yellow",
]);

export type ValidatedCanvasCommand =
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

export type CanvasCommandValidation = {
  commands: ValidatedCanvasCommand[];
  errors: string[];
};

function cleanId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").replace(/-+/g, "-").slice(0, 96);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeDimension(value: number | undefined) {
  return clampNumber(value ?? DEFAULT_SHAPE_SIZE, MIN_SHAPE_SIZE, CANVAS_MAX_DIMENSION);
}

function normalizeCoordinate(value: number) {
  return clampNumber(value, -MAX_COORDINATE, MAX_COORDINATE);
}

function normalizeText(value: string | undefined) {
  return value?.trim().slice(0, CANVAS_MAX_TEXT_LENGTH);
}

function normalizeColor(value: CanvasShapeColor | undefined) {
  if (!value) return undefined;
  return VALID_COLORS.has(value) ? value : undefined;
}

function normalizeShape(shape: CanvasShapeInput): CanvasShapeInput | null {
  const id = cleanId(shape.id);
  if (!id) return null;
  return {
    id,
    kind: shape.kind,
    x: normalizeCoordinate(shape.x),
    y: normalizeCoordinate(shape.y),
    width: normalizeDimension(shape.width),
    height: normalizeDimension(shape.height),
    text: normalizeText(shape.text),
    color: normalizeColor(shape.color),
    targetId: shape.targetId ? cleanId(shape.targetId) : undefined,
  };
}

function normalizeIds(ids: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const clean = cleanId(id);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function idsExist(ids: string[], existingShapeIds: ReadonlySet<string>) {
  return ids.every((id) => existingShapeIds.has(id));
}

function rejectMissingIds(ids: string[], existingShapeIds: ReadonlySet<string>, errors: string[], label: string) {
  const missing = ids.filter((id) => !existingShapeIds.has(id));
  if (missing.length > 0) {
    errors.push(`${label}: missing shape ids ${missing.join(", ")}`);
    return true;
  }
  return false;
}

function validateCreate(command: CanvasCreateCommand, errors: string[]) {
  const shapes = command.shapes.map(normalizeShape).filter((shape) => shape !== null);
  if (shapes.length === 0) {
    errors.push("create: no valid shapes");
    return null;
  }
  return { type: "create", shapes } satisfies CanvasCreateCommand;
}

function validateUpdate(command: CanvasUpdateCommand, existingShapeIds: ReadonlySet<string>, errors: string[]) {
  const shapes = command.shapes.map(normalizeShape).filter((shape) => shape !== null);
  if (shapes.length === 0) {
    errors.push("update: no valid shapes");
    return null;
  }
  if (rejectMissingIds(shapes.map((shape) => shape.id), existingShapeIds, errors, "update")) return null;
  return { type: "update", shapes } satisfies CanvasUpdateCommand;
}

function validateDelete(command: CanvasDeleteCommand, existingShapeIds: ReadonlySet<string>, errors: string[]) {
  const ids = normalizeIds(command.ids);
  if (ids.length === 0) {
    errors.push("delete: no valid ids");
    return null;
  }
  if (rejectMissingIds(ids, existingShapeIds, errors, "delete")) return null;
  if (existingShapeIds.size > 0 && ids.length / existingShapeIds.size >= MAX_DELETE_RATIO) {
    errors.push("delete: refusing to remove most of the canvas in one operation");
    return null;
  }
  return { type: "delete", ids } satisfies CanvasDeleteCommand;
}

function validateMove(command: CanvasMoveCommand, existingShapeIds: ReadonlySet<string>, errors: string[]) {
  const ids = normalizeIds(command.ids);
  if (ids.length === 0) {
    errors.push("move: no valid ids");
    return null;
  }
  if (rejectMissingIds(ids, existingShapeIds, errors, "move")) return null;
  return {
    type: "move",
    ids,
    dx: clampNumber(command.dx, -CANVAS_MAX_DIMENSION, CANVAS_MAX_DIMENSION),
    dy: clampNumber(command.dy, -CANVAS_MAX_DIMENSION, CANVAS_MAX_DIMENSION),
  } satisfies CanvasMoveCommand;
}

function validateResize(command: CanvasResizeCommand, existingShapeIds: ReadonlySet<string>, errors: string[]) {
  const ids = normalizeIds(command.ids);
  if (ids.length === 0) {
    errors.push("resize: no valid ids");
    return null;
  }
  if (rejectMissingIds(ids, existingShapeIds, errors, "resize")) return null;
  return {
    type: "resize",
    ids,
    width: normalizeDimension(command.width),
    height: normalizeDimension(command.height),
  } satisfies CanvasResizeCommand;
}

function validateConnect(command: CanvasConnectCommand, existingShapeIds: ReadonlySet<string>, errors: string[]) {
  const id = cleanId(command.id);
  const fromId = cleanId(command.fromId);
  const toId = cleanId(command.toId);
  if (!id || !fromId || !toId) {
    errors.push("connect: invalid ids");
    return null;
  }
  if (!idsExist([fromId, toId], existingShapeIds)) {
    errors.push("connect: source or target shape does not exist");
    return null;
  }
  return {
    type: "connect",
    id,
    fromId,
    toId,
    text: normalizeText(command.text),
  } satisfies CanvasConnectCommand;
}

function validateIdsCommand<T extends CanvasArrangeCommand | CanvasGroupCommand | CanvasStyleCommand>(
  command: T,
  existingShapeIds: ReadonlySet<string>,
  errors: string[],
) {
  const ids = normalizeIds(command.ids);
  if (ids.length === 0) {
    errors.push(`${command.type}: no valid ids`);
    return null;
  }
  if (rejectMissingIds(ids, existingShapeIds, errors, command.type)) return null;
  if (command.type === "arrange") {
    return { type: "arrange", ids, direction: command.direction } satisfies CanvasArrangeCommand;
  }
  if (command.type === "style") {
    return { type: "style", ids, color: command.color } satisfies CanvasStyleCommand;
  }
  return { type: "group", ids } satisfies CanvasGroupCommand;
}

function validateInsertImage(command: CanvasInsertImageCommand, errors: string[]) {
  const id = cleanId(command.asset.id);
  if (!id || !command.asset.mimeType.startsWith("image/")) {
    errors.push("insertImage: invalid image asset");
    return null;
  }
  return {
    type: "insertImage",
    asset: { ...command.asset, id },
    x: normalizeCoordinate(command.x),
    y: normalizeCoordinate(command.y),
    width: normalizeDimension(command.width),
    height: normalizeDimension(command.height),
  } satisfies CanvasInsertImageCommand;
}

export function validateCanvasCommands(
  commands: CanvasCommand[],
  existingShapeIds: ReadonlySet<string>,
): CanvasCommandValidation {
  const errors: string[] = [];
  const validated: ValidatedCanvasCommand[] = [];
  const limitedCommands = commands.slice(0, CANVAS_MAX_COMMANDS_PER_RUN);

  if (commands.length > CANVAS_MAX_COMMANDS_PER_RUN) {
    errors.push(`too many commands; limited to ${CANVAS_MAX_COMMANDS_PER_RUN}`);
  }

  for (const command of limitedCommands) {
    const next =
      command.type === "create"
        ? validateCreate(command, errors)
        : command.type === "update"
          ? validateUpdate(command, existingShapeIds, errors)
          : command.type === "delete"
            ? validateDelete(command, existingShapeIds, errors)
            : command.type === "move"
              ? validateMove(command, existingShapeIds, errors)
              : command.type === "resize"
                ? validateResize(command, existingShapeIds, errors)
                : command.type === "connect"
                  ? validateConnect(command, existingShapeIds, errors)
                  : command.type === "insertImage"
                    ? validateInsertImage(command, errors)
                    : command.type === "template"
                      ? command
                      : validateIdsCommand(command, existingShapeIds, errors);
    if (next) validated.push(next);
  }

  return { commands: validated, errors };
}

export function createCanvasCommandResult(
  applied: number,
  checkpointIds: string[],
  errors: string[],
): CanvasCommandResult {
  return {
    ok: errors.length === 0,
    applied,
    checkpointIds,
    errors,
  };
}
