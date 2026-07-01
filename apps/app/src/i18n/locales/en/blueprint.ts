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
  "blueprint.empty_body": "Pick a starting point or just type below.",
  "blueprint.empty_title": "What do you want to do?",
  "blueprint.minimal_body":
    "Ask a question about this workspace or use a starter prompt.",
  "blueprint.minimal_title": "Start with a task",
  "blueprint.starter_blueprint_desc":
    "Design a repeatable workflow with skills, commands, and handoff steps.",
  "blueprint.starter_blueprint_prompt":
    "Help me design a reusable automation blueprint for this workspace. Ask what should be standardized, then propose the workflow.",
  "blueprint.starter_blueprint_title": "Plan an automation blueprint",
  "blueprint.starter_chrome_desc":
    "Start a browser automation conversation right away.",
  "blueprint.starter_chrome_prompt":
    "Use the built-in browser to automate a repetitive web task.",
  "blueprint.starter_chrome_title": "Automate the browser",
  "blueprint.starter_command_desc":
    "Turn a repeated workflow into a slash command for this workspace.",
  "blueprint.starter_command_prompt":
    "Help me create a reusable /command for this workspace. Ask what workflow I want to automate, then draft the command.",
  "blueprint.starter_command_title": "Create a reusable command",
  "blueprint.starter_connect_openai_desc":
    "Add your OpenAI provider so ChatGPT models are ready in new sessions.",
  "blueprint.starter_connect_openai_title": "Connect ChatGPT",
  "blueprint.starter_csv_desc": "Clean up or generate spreadsheet data.",
  "blueprint.starter_csv_prompt":
    "Help me create or edit CSV files on this computer.",
  "blueprint.starter_csv_title": "Work on a CSV",
  "blueprint.starter_explore_desc":
    "Summarize the files and suggest the best first task to tackle.",
  "blueprint.starter_explore_prompt":
    "Summarize this workspace, point out the most important files, and suggest the best first task.",
  "blueprint.starter_explore_title": "Explore this workspace",
  "blueprint.welcome_message": `Hi welcome to ${APP_NAME}!\n\nPeople use us to write .csv files on their computer, automate browser tasks, and sync contacts to Notion.\n\nBut the only limit is your imagination.\n\nWhat would you want to do?`,
  "blueprint.welcome_title": `Welcome to ${APP_NAME}`,
} as const;
