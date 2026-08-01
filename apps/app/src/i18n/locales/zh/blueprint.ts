import { APP_NAME } from "../brand";

export default {
  "blueprint.automation_body": "从可复用的工作流开始，或在下方输入你的任务。",
  "blueprint.automation_title": "你想自动化什么？",
  "blueprint.csv_session_assistant":
    "我可以帮你生成、清洗、合并和汇总CSV文件。你想自动化哪种CSV工作？",
  "blueprint.csv_session_title": "CSV工作流创意",
  "blueprint.csv_session_user": "我想把多个工具的导出合并成一个整洁的CSV。",
  "blueprint.empty_body": "从办公起点开始，或直接在下方说明你要完成的事。",
  "blueprint.empty_title": "今天要办哪件事？",
  "blueprint.minimal_body": "描述一个办公任务，或使用下方起点。",
  "blueprint.minimal_title": "从一个办公任务开始",
  "blueprint.starter_blueprint_desc":
    "把重复的办公流程沉淀成可定时运行的自动化。",
  "blueprint.starter_blueprint_prompt":
    "帮我设计一个可复用的办公自动化：先问我要标准化什么（例如日报、汇总、提醒），再给出步骤与输出要求。",
  "blueprint.starter_blueprint_title": "规划办公自动化",
  "blueprint.starter_chrome_desc": "协助完成重复的网页或后台操作。",
  "blueprint.starter_chrome_prompt": "使用内置浏览器帮我完成一个重复性办公网页任务。",
  "blueprint.starter_chrome_title": "网页办公助手",
  "blueprint.starter_command_desc": "把常用办公步骤收成可复用指令。",
  "blueprint.starter_command_prompt":
    "帮我为此工作区创建一个可复用的办公指令。先问我想固化什么流程，再起草命令。",
  "blueprint.starter_command_title": "创建可复用指令",
  "blueprint.starter_connect_openai_desc":
    "先连接任意模型服务商（官方、兼容 API 或本机模型），再开始对话。",
  "blueprint.starter_connect_openai_title": "连接你的模型",
  "blueprint.starter_csv_desc": "清洗、合并或生成表格数据。",
  "blueprint.starter_csv_prompt": "帮我在这台电脑上创建或编辑表格（CSV/Excel）。",
  "blueprint.starter_csv_title": "处理表格",
  "blueprint.starter_explore_desc": "汇总工作区文件并建议先办哪件事。",
  "blueprint.starter_explore_prompt":
    "汇总此工作区里的办公材料，指出最重要的文件，并建议最适合先处理的任务。",
  "blueprint.starter_explore_title": "浏览工作区",
  "blueprint.welcome_message": `你好，欢迎使用 ${APP_NAME}。\n\n这是本地办公工作台：任务与文件默认在本机，模型可自选（官方服务、兼容 API 或本机模型）。\n\n常见起点：起草文档与纪要、整理表格、定时自动化、从工作区文件继续推进。\n\n还没有模型时，请先在设置里连接服务商；连上后即可直接派活。\n\n今天想先办哪件事？`,
  "blueprint.welcome_title": `欢迎使用 ${APP_NAME}`,
} as const;
