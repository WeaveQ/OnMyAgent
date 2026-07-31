import { APP_NAME } from "../brand";

export default {
  "blueprint.automation_body":
    "Start from a reusable workflow or type your own task below.",
  "blueprint.automation_title": "What do you want to automate?",
  "blueprint.csv_session_assistant":
    "I can help you generate, clean, merge, and summarize CSV files. What kind of CSV work do you want to automate?",
  "blueprint.csv_session_title": "CSV workflow ideas",
  "blueprint.csv_session_user":
    "I want to combine exports from multiple tools into one clean CSV.",
  "blueprint.empty_body": "Pick an office starter, or describe the work below.",
  "blueprint.empty_title": "What should we get done?",
  "blueprint.minimal_body":
    "Describe an office task, or use a starter below.",
  "blueprint.minimal_title": "Start with office work",
  "blueprint.starter_blueprint_desc":
    "Turn a repeated office process into a schedule-ready automation.",
  "blueprint.starter_blueprint_prompt":
    "Help me design a reusable office automation. Ask what should be standardized (digests, summaries, reminders), then propose steps and outputs.",
  "blueprint.starter_blueprint_title": "Plan office automation",
  "blueprint.starter_chrome_desc":
    "Help with repetitive web or back-office steps.",
  "blueprint.starter_chrome_prompt":
    "Use the built-in browser to help with a repetitive office web task.",
  "blueprint.starter_chrome_title": "Web office helper",
  "blueprint.starter_command_desc":
    "Turn a frequent office routine into a reusable command.",
  "blueprint.starter_command_prompt":
    "Help me create a reusable office command for this workspace. Ask what process I want to lock in, then draft it.",
  "blueprint.starter_command_title": "Create a reusable command",
  "blueprint.starter_connect_openai_desc":
    "Connect any model provider first (hosted, compatible API, or local) — then start chatting.",
  "blueprint.starter_connect_openai_title": "Connect your model",
  "blueprint.starter_csv_desc": "Clean, merge, or generate spreadsheet data.",
  "blueprint.starter_csv_prompt":
    "Help me create or edit spreadsheets (CSV/Excel) on this computer.",
  "blueprint.starter_csv_title": "Work with sheets",
  "blueprint.starter_explore_desc":
    "Summarize workspace files and suggest the best first task.",
  "blueprint.starter_explore_prompt":
    "Summarize the office materials in this workspace, point out the most important files, and suggest the best first task.",
  "blueprint.starter_explore_title": "Browse workspace",
  "blueprint.welcome_message": `Welcome to ${APP_NAME}.\n\nThis is a local office workspace: work and files stay on your machine by default, and you bring your own model (hosted, compatible API, or local).\n\nCommon starts: draft docs and notes, tidy spreadsheets, schedule automations, or continue from files already in the workspace.\n\nIf no model is connected yet, open Settings and add a provider — then send your first task.\n\nWhat should we get done first?`,
  "blueprint.welcome_title": `Welcome to ${APP_NAME}`,
} as const;
