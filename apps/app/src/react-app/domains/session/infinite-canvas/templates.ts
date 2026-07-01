import type { CanvasShapeInput, CanvasTemplateId } from "./types";

export type CanvasTemplateDefinition = {
  id: CanvasTemplateId;
  labelKey: string;
  descriptionKey: string;
  shapes: CanvasShapeInput[];
};

export const CANVAS_TEMPLATES: CanvasTemplateDefinition[] = [
  {
    id: "blank",
    labelKey: "infinite_canvas.template.blank",
    descriptionKey: "infinite_canvas.template.blank",
    shapes: [],
  },
  {
    id: "flowchart",
    labelKey: "infinite_canvas.template.flowchart",
    descriptionKey: "infinite_canvas.template.flowchart",
    shapes: [
      { id: "start", kind: "rectangle", x: 40, y: 80, width: 180, height: 72, text: "Start", color: "green" },
      { id: "step", kind: "rectangle", x: 300, y: 80, width: 220, height: 72, text: "Process", color: "blue" },
      { id: "decision", kind: "diamond", x: 600, y: 68, width: 140, height: 96, text: "Decision", color: "yellow" },
      { id: "done", kind: "rectangle", x: 820, y: 80, width: 180, height: 72, text: "Done", color: "violet" },
      { id: "a1", kind: "arrow", x: 230, y: 116, targetId: "step" },
      { id: "a2", kind: "arrow", x: 530, y: 116, targetId: "decision" },
      { id: "a3", kind: "arrow", x: 750, y: 116, targetId: "done" },
    ],
  },
  {
    id: "taskBreakdown",
    labelKey: "infinite_canvas.template.taskBreakdown",
    descriptionKey: "infinite_canvas.template.taskBreakdown",
    shapes: [
      { id: "goal", kind: "note", x: 40, y: 48, text: "Goal", color: "blue" },
      { id: "phase1", kind: "note", x: 40, y: 220, text: "Phase 1", color: "yellow" },
      { id: "phase2", kind: "note", x: 300, y: 220, text: "Phase 2", color: "green" },
      { id: "phase3", kind: "note", x: 560, y: 220, text: "Phase 3", color: "violet" },
      { id: "risk", kind: "note", x: 820, y: 220, text: "Risks", color: "red" },
    ],
  },
  {
    id: "architecture",
    labelKey: "infinite_canvas.template.architecture",
    descriptionKey: "infinite_canvas.template.architecture",
    shapes: [
      { id: "ui", kind: "rectangle", x: 40, y: 80, width: 220, height: 96, text: "UI", color: "blue" },
      { id: "state", kind: "rectangle", x: 340, y: 80, width: 220, height: 96, text: "State / Domain", color: "green" },
      { id: "api", kind: "rectangle", x: 640, y: 80, width: 220, height: 96, text: "Local API", color: "yellow" },
      { id: "runtime", kind: "rectangle", x: 940, y: 80, width: 220, height: 96, text: "Runtime", color: "violet" },
      { id: "ui-state", kind: "arrow", x: 270, y: 128, targetId: "state" },
      { id: "state-api", kind: "arrow", x: 570, y: 128, targetId: "api" },
      { id: "api-runtime", kind: "arrow", x: 870, y: 128, targetId: "runtime" },
    ],
  },
  {
    id: "meeting",
    labelKey: "infinite_canvas.template.meeting",
    descriptionKey: "infinite_canvas.template.meeting",
    shapes: [
      { id: "agenda", kind: "note", x: 40, y: 60, text: "Agenda", color: "blue" },
      { id: "notes", kind: "note", x: 320, y: 60, text: "Notes", color: "yellow" },
      { id: "decisions", kind: "note", x: 600, y: 60, text: "Decisions", color: "green" },
      { id: "actions", kind: "note", x: 880, y: 60, text: "Actions", color: "violet" },
    ],
  },
  {
    id: "expertAnalysis",
    labelKey: "infinite_canvas.template.expertAnalysis",
    descriptionKey: "infinite_canvas.template.expertAnalysis",
    shapes: [
      { id: "question", kind: "note", x: 40, y: 64, text: "Question", color: "blue" },
      { id: "evidence", kind: "note", x: 320, y: 64, text: "Evidence", color: "green" },
      { id: "options", kind: "note", x: 600, y: 64, text: "Options", color: "yellow" },
      { id: "recommendation", kind: "note", x: 880, y: 64, text: "Recommendation", color: "violet" },
      { id: "risks", kind: "note", x: 1160, y: 64, text: "Risks", color: "red" },
    ],
  },
];

export function templateById(id: CanvasTemplateId) {
  return CANVAS_TEMPLATES.find((template) => template.id === id) ?? CANVAS_TEMPLATES[0];
}
