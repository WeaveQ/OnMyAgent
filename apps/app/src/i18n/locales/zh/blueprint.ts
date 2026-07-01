import { APP_NAME } from "../brand";

export default {
  "blueprint.automation_body": "从可复用的工作流开始，或在下方输入你的任务。",
  "blueprint.automation_title": "你想自动化什么？",
  "blueprint.csv_session_assistant":
    "我可以帮你生成、清洗、合并和汇总CSV文件。你想自动化哪种CSV工作？",
  "blueprint.csv_session_title": "CSV工作流创意",
  "blueprint.csv_session_user": "我想把多个工具的导出合并成一个整洁的CSV。",
  "blueprint.empty_body": "选择一个起点，或直接在下方输入。",
  "blueprint.empty_title": "你想做什么？",
  "blueprint.minimal_body": "询问关于此工作区的问题，或使用启动提示词。",
  "blueprint.minimal_title": "从一个任务开始",
  "blueprint.starter_blueprint_desc":
    "设计一个包含skills、命令和交接步骤的可复用工作流。",
  "blueprint.starter_blueprint_prompt":
    "帮我为此工作区设计一个可复用的自动化蓝图。先问我想标准化什么，然后提出工作流方案。",
  "blueprint.starter_blueprint_title": "规划自动化蓝图",
  "blueprint.starter_chrome_desc": "立即开始浏览器自动化对话。",
  "blueprint.starter_chrome_prompt": "使用内置浏览器自动化一个重复性网页任务。",
  "blueprint.starter_chrome_title": "浏览器自动化",
  "blueprint.starter_command_desc": "将重复的工作流转化为此工作区的斜杠命令。",
  "blueprint.starter_command_prompt":
    "帮我为此工作区创建一个可复用的/command。先问我想自动化什么工作流，然后起草命令。",
  "blueprint.starter_command_title": "创建可复用命令",
  "blueprint.starter_connect_openai_desc":
    "添加 OpenAI 模型服务商，让 ChatGPT 模型在新会话中即可使用。",
  "blueprint.starter_connect_openai_title": "连接ChatGPT",
  "blueprint.starter_csv_desc": "清洗或生成电子表格数据。",
  "blueprint.starter_csv_prompt": "帮我在这台电脑上创建或编辑CSV文件。",
  "blueprint.starter_csv_title": "处理CSV",
  "blueprint.starter_explore_desc": "汇总文件并建议最适合先处理的任务。",
  "blueprint.starter_explore_prompt":
    "汇总此工作区，指出最重要的文件，并建议最适合先处理的任务。",
  "blueprint.starter_explore_title": "探索此工作区",
  "blueprint.welcome_message": `你好，欢迎使用${APP_NAME}！\n\n大家用${APP_NAME}在电脑上编写CSV文件、自动化浏览器任务，以及将联系人同步到Notion。\n\n但唯一的限制是你的想象力。\n\n你想做什么？`,
  "blueprint.welcome_title": `欢迎使用${APP_NAME}`,
} as const;
