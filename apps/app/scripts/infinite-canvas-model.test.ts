import { describe, expect, test } from "bun:test";
import { createShapeId, type Editor, type TLCreateShapePartial, type TLShapeId, type TLShapePartial } from "tldraw";

import {
  validateCanvasCommands,
} from "../src/react-app/domains/session/infinite-canvas/commands";
import {
  createEmptyCanvasSnapshot,
  loadCanvasSnapshot,
  saveCanvasSnapshot,
} from "../src/react-app/domains/session/infinite-canvas/persistence";
import {
  canvasBackupStorageKey,
  canvasStorageKey,
  createCanvasSessionKey,
} from "../src/react-app/domains/session/infinite-canvas/session-key";
import { templateById } from "../src/react-app/domains/session/infinite-canvas/templates";
import {
  getCanvasContextSummary,
  runCanvasCommands,
} from "../src/react-app/domains/session/infinite-canvas/tldraw-adapter";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

type StoredShape = {
  id: TLShapeId;
  type: string;
  typeName: "shape";
  parentId: string;
  index: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

class FakeCanvasEditor {
  readonly shapes = new Map<string, StoredShape>();
  selectedShapeIds: TLShapeId[] = [];
  private checkpointIndex = 0;

  markHistoryStoppingPoint(label: string) {
    this.checkpointIndex += 1;
    return `${label}:${this.checkpointIndex}`;
  }

  getCurrentPageShapeIds() {
    return new Set(Array.from(this.shapes.values()).map((shape) => shape.id));
  }

  createShape(shape: TLCreateShapePartial) {
    this.createShapes([shape]);
  }

  createShapes(shapes: TLCreateShapePartial[]) {
    for (const shape of shapes) {
      this.shapes.set(shape.id, {
        id: shape.id,
        type: shape.type,
        typeName: "shape",
        parentId: "page:page",
        index: "a1",
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        props: shape.props ?? {},
      });
    }
  }

  updateShapes(partials: TLShapePartial[]) {
    for (const partial of partials) {
      const shape = this.shapes.get(partial.id);
      if (!shape) continue;
      this.shapes.set(partial.id, {
        ...shape,
        x: partial.x ?? shape.x,
        y: partial.y ?? shape.y,
        props: { ...shape.props, ...(partial.props ?? {}) },
      });
    }
  }

  deleteShapes(ids: TLShapeId[]) {
    for (const id of ids) {
      this.shapes.delete(id);
    }
  }

  nudgeShapes(ids: TLShapeId[], offset: { x: number; y: number }) {
    for (const id of ids) {
      const shape = this.shapes.get(id);
      if (!shape) continue;
      this.shapes.set(id, { ...shape, x: shape.x + offset.x, y: shape.y + offset.y });
    }
  }

  resizeShape(id: TLShapeId, width: number, height: number) {
    const shape = this.shapes.get(id);
    if (!shape) return;
    this.shapes.set(id, { ...shape, props: { ...shape.props, w: width, h: height } });
  }

  getShape(id: TLShapeId) {
    return this.shapes.get(id);
  }

  getShapePageBounds(shape: StoredShape) {
    const width = typeof shape.props.w === "number" ? shape.props.w : 100;
    const height = typeof shape.props.h === "number" ? shape.props.h : 100;
    return {
      minX: shape.x,
      maxX: shape.x + width,
      midY: shape.y + height / 2,
    };
  }

  groupShapes() {}

  distributeShapes() {}

  zoomToFit() {}

  getCurrentPageShapes() {
    return Array.from(this.shapes.values());
  }

  getSelectedShapeIds() {
    return this.selectedShapeIds;
  }
}

function fakeEditorAsTldrawEditor(editor: FakeCanvasEditor): Editor {
  return editor as unknown as Editor;
}

describe("infinite canvas model", () => {
  test("creates stable sanitized session keys and storage keys", () => {
    const key = createCanvasSessionKey({
      workspaceId: " ws 1 ",
      sessionId: "draft:abc/123",
      surface: "assistant-code",
    });

    expect(key).toEqual({
      workspaceId: "ws-1",
      sessionId: "draft:abc-123",
      surface: "assistant-code",
    });
    expect(canvasStorageKey(key)).toContain("assistant-code:ws-1:draft:abc-123");
  });

  test("saves, loads, and backs up corrupt snapshots", () => {
    const storage = new MemoryStorage();
    const key = createCanvasSessionKey({
      workspaceId: "workspace",
      sessionId: "session",
      surface: "expert",
    });
    const snapshot = createEmptyCanvasSnapshot(key);

    saveCanvasSnapshot(storage, snapshot);
    expect(loadCanvasSnapshot(storage, key).key).toEqual(key);

    storage.setItem(canvasStorageKey(key), "{bad-json");
    const recovered = loadCanvasSnapshot(storage, key);
    expect(recovered.document).toBeNull();
    expect(storage.getItem(canvasBackupStorageKey(key))).toBe("{bad-json");
  });

  test("validates commands with limits, shape ownership, and clear-board protection", () => {
    const existing = new Set(["a", "b", "c"]);
    const validation = validateCanvasCommands(
      [
        { type: "move", ids: ["a", "missing"], dx: 5, dy: 5 },
        { type: "delete", ids: ["a", "b", "c"] },
        {
          type: "create",
          shapes: [
            {
              id: "new shape",
              kind: "note",
              x: Number.POSITIVE_INFINITY,
              y: 20,
              text: "hello",
            },
          ],
        },
      ],
      existing,
    );

    expect(validation.commands).toHaveLength(1);
    expect(validation.commands[0]?.type).toBe("create");
    expect(validation.errors.join("\n")).toContain("missing shape ids");
    expect(validation.errors.join("\n")).toContain("refusing to remove most");
  });

  test("ships editable starter templates", () => {
    expect(templateById("blank").shapes).toEqual([]);
    expect(templateById("flowchart").shapes.length).toBeGreaterThan(3);
    expect(templateById("taskBreakdown").shapes.some((shape) => shape.kind === "note")).toBe(true);
    expect(templateById("architecture").shapes.some((shape) => shape.kind === "arrow")).toBe(true);
  });

  test("applies AI canvas commands step by step and exposes readable context", () => {
    const fakeEditor = new FakeCanvasEditor();
    const editor = fakeEditorAsTldrawEditor(fakeEditor);
    const createResult = runCanvasCommands(editor, [
      {
        type: "create",
        shapes: [
          {
            id: "box",
            kind: "note",
            x: 10,
            y: 20,
            text: "AI should read this",
          },
        ],
      },
    ]);
    const moveResult = runCanvasCommands(editor, [{ type: "move", ids: ["box"], dx: 12, dy: 8 }]);
    const styleResult = runCanvasCommands(editor, [{ type: "style", ids: ["box"], color: "green" }]);

    expect(createResult).toMatchObject({ ok: true, applied: 1 });
    expect(moveResult).toMatchObject({ ok: true, applied: 1 });
    expect(styleResult).toMatchObject({ ok: true, applied: 1 });
    expect(createResult.checkpointIds).toHaveLength(1);
    expect(moveResult.checkpointIds).toHaveLength(1);
    expect(styleResult.checkpointIds).toHaveLength(1);

    const shape = fakeEditor.shapes.get(createShapeId("box"));
    expect(shape?.x).toBe(22);
    expect(shape?.y).toBe(28);
    expect(shape?.props.color).toBe("green");

    fakeEditor.selectedShapeIds = [createShapeId("box")];
    const context = getCanvasContextSummary(editor);
    expect(context.shapeCount).toBe(1);
    expect(context.selectedShapeIds).toEqual(["box"]);
    expect(context.text.join("\n")).toContain("AI should read this");
  });
});
