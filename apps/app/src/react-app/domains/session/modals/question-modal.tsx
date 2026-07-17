/** @jsxImportSource react */
import { useEffect, useReducer } from "react";
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client";
import { Check, ChevronRight, HelpCircle } from "lucide-react";

import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

export type QuestionPanelProps = {
  questions: QuestionInfo[];
  busy: boolean;
  onReply: (answers: string[][]) => void;
};

type QuestionState = {
  currentIndex: number;
  answers: string[][];
  currentSelection: string[];
  customInput: string;
  focusedOptionIndex: number;
};

type QuestionAction =
  | { type: "reset"; questionCount: number }
  | { type: "setCustomInput"; value: string }
  | { type: "setFocusedOptionIndex"; value: number }
  | { type: "moveFocusedOption"; direction: 1 | -1; optionsCount: number }
  | { type: "toggleMultipleOption"; option: string }
  | { type: "selectOption"; option: string }
  | { type: "advance"; answers: string[][] }
  | { type: "setAnswers"; answers: string[][] };

const initialQuestionState: QuestionState = {
  currentIndex: 0,
  answers: [],
  currentSelection: [],
  customInput: "",
  focusedOptionIndex: 0,
};

function questionReducer(state: QuestionState, action: QuestionAction): QuestionState {
  switch (action.type) {
    case "reset":
      return {
        currentIndex: 0,
        answers: new Array(action.questionCount).fill([]),
        currentSelection: [],
        customInput: "",
        focusedOptionIndex: 0,
      };
    case "setCustomInput":
      return { ...state, customInput: action.value };
    case "setFocusedOptionIndex":
      return { ...state, focusedOptionIndex: action.value };
    case "moveFocusedOption":
      if (action.optionsCount <= 0) return state;
      return {
        ...state,
        focusedOptionIndex:
          (state.focusedOptionIndex + action.direction + action.optionsCount) %
          action.optionsCount,
      };
    case "toggleMultipleOption": {
      const selected = state.currentSelection.includes(action.option)
        ? state.currentSelection.filter((option) => option !== action.option)
        : [...state.currentSelection, action.option];
      return { ...state, currentSelection: selected };
    }
    case "selectOption":
      return { ...state, currentSelection: [action.option] };
    case "advance":
      return {
        ...state,
        answers: action.answers,
        currentIndex: state.currentIndex + 1,
        currentSelection: [],
        customInput: "",
        focusedOptionIndex: 0,
      };
    case "setAnswers":
      return { ...state, answers: action.answers };
  }
}

export function QuestionPanel(props: QuestionPanelProps) {
  const [state, dispatch] = useReducer(questionReducer, initialQuestionState);

  useEffect(() => {
    dispatch({ type: "reset", questionCount: props.questions.length });
  }, [props.questions]);

  const currentQuestion = props.questions[state.currentIndex];
  const options = currentQuestion?.options ?? [];
  const isLastQuestion = state.currentIndex === props.questions.length - 1;
  const canProceed = (() => {
    if (!currentQuestion) return false;
    if (currentQuestion.custom && state.customInput.trim().length > 0) return true;
    return state.currentSelection.length > 0;
  })();

  const handleNext = () => {
    if (!canProceed || !currentQuestion) return;
    const nextAnswer = [...state.currentSelection];
    if (currentQuestion.custom && state.customInput.trim()) {
      nextAnswer.push(state.customInput.trim());
    }
    const newAnswers = [...state.answers];
    newAnswers[state.currentIndex] = nextAnswer;
    if (isLastQuestion) {
      dispatch({ type: "setAnswers", answers: newAnswers });
      props.onReply(newAnswers);
    } else {
      dispatch({ type: "advance", answers: newAnswers });
    }
  };

  const toggleOption = (option: string) => {
    if (!currentQuestion || props.busy) return;
    if (currentQuestion.multiple) {
      dispatch({ type: "toggleMultipleOption", option });
      return;
    }
    dispatch({ type: "selectOption", option });
    if (!currentQuestion.custom) {
      setTimeout(() => {
        const newAnswers = [...state.answers];
        newAnswers[state.currentIndex] = [option];
        if (isLastQuestion) {
          dispatch({ type: "setAnswers", answers: newAnswers });
          props.onReply(newAnswers);
        } else {
          dispatch({ type: "advance", answers: newAnswers });
        }
      }, 150);
    }
  };

  if (!currentQuestion) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="border-b border-dls-border px-4 py-3">
        <div className="flex items-start gap-2.5">
          <IconTile size="2xs" tone="info" shape="circle" border className="mt-0.5 border-dls-accent/30">
            <HelpCircle size={12} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="text-sm font-medium leading-5 text-dls-text">
                {currentQuestion.header || t("common.question")}
              </div>
              <div className="text-xs font-medium leading-4 text-dls-secondary">
                {t("question_modal.question_counter", undefined, {
                  current: state.currentIndex + 1,
                  total: props.questions.length,
                })}
              </div>
            </div>
            <div className="mt-1 text-sm leading-6 text-dls-secondary">
              {currentQuestion.question}
            </div>
          </div>
        </div>
      </div>

      <div className="max-h-72 space-y-3 overflow-auto px-4 py-3">
        {options.length > 0 ? (
          <div className="space-y-2">
            {options.map((opt, idx) => {
              const isSelected = state.currentSelection.includes(opt.label);
              const isFocused = state.focusedOptionIndex === idx;
              return (
                <ActionRowButton
                  key={`${opt.label}:${idx}`}
                  type="button"
                  disabled={props.busy}
                  density="compact"
                  className={`justify-between gap-3
                        ${
                          isSelected
                            ? "border-dls-accent/30 bg-dls-decision-soft text-dls-text"
                            : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                        }
                        ${isFocused ? "border-dls-accent/30 bg-dls-hover ring-2 ring-dls-accent/30" : ""}
                      `}
                  onClick={() => {
                    dispatch({ type: "setFocusedOptionIndex", value: idx });
                    toggleOption(opt.label);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-dls-text">{opt.label}</span>
                    {opt.description && opt.description !== opt.label ? (
                      <span className="mt-1 block text-xs leading-5 text-dls-secondary">{opt.description}</span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <IconTile size="2xs" tone="softAccent" shape="circle" className="bg-dls-accent">
                      <Check size={12} className="text-white" strokeWidth={3} />
                    </IconTile>
                  ) : null}
                </ActionRowButton>
              );
            })}
          </div>
        ) : null}

          {currentQuestion.custom ? (
            <div className="border-t border-dls-border pt-3">
              <label className="mb-2 block text-xs font-medium text-dls-secondary">
                {t("question_modal.custom_answer_label")}
              </label>
              <Input
                type="text"
                value={state.customInput}
                onChange={(event) =>
                  dispatch({
                    type: "setCustomInput",
                    value: event.currentTarget.value,
                  })
                }
                className="h-11 rounded-xl bg-dls-surface px-4 text-sm text-dls-text placeholder:text-dls-secondary focus-visible:ring-4 focus-visible:ring-dls-accent/30"
                placeholder={t("question_modal.custom_answer_placeholder")}
                disabled={props.busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (event.nativeEvent.isComposing || event.keyCode === 229)
                      return;
                    event.stopPropagation();
                    handleNext();
                  }
                }}
              />
            </div>
          ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-dls-secondary flex items-center gap-2">
            {props.busy ? "Submitting..." : null}
          </div>

          <div className="flex gap-2">
            {currentQuestion.multiple || currentQuestion.custom ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed || props.busy}
              >
                {isLastQuestion ? t("common.submit") : t("common.next")}
                {!isLastQuestion ? (
                  <ChevronRight data-icon="inline-end" />
                ) : null}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
