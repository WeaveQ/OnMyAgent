import { APP_NAME } from "../brand";

export default {
  "blueprint.automation_body": "從可複用的工作流開始，或在下方輸入你的任務。",
  "blueprint.automation_title": "你想自動化什麼？",
  "blueprint.csv_session_assistant":
    "我可以幫你生成、清洗、合併和彙總CSV文件。你想自動化哪種CSV工作？",
  "blueprint.csv_session_title": "CSV工作流創意",
  "blueprint.csv_session_user": "我想把多個工具的導出合併成一個整潔的CSV。",
  "blueprint.empty_body": "從辦公起點開始，或直接在下方說明你要完成的事。",
  "blueprint.empty_title": "今天要辦哪件事？",
  "blueprint.minimal_body": "描述一個辦公任務，或使用下方起點。",
  "blueprint.minimal_title": "從一個辦公任務開始",
  "blueprint.starter_blueprint_desc":
    "把重複的辦公流程沉澱成可定時運行的自動化。",
  "blueprint.starter_blueprint_prompt":
    "幫我設計一個可複用的辦公自動化：先問我要標準化什麼（例如日報、彙總、提醒），再給出步驟與輸出要求。",
  "blueprint.starter_blueprint_title": "規劃辦公自動化",
  "blueprint.starter_chrome_desc": "協助完成重複的網頁或後台操作。",
  "blueprint.starter_chrome_prompt": "使用內置瀏覽器幫我完成一個重複性辦公網頁任務。",
  "blueprint.starter_chrome_title": "網頁辦公助手",
  "blueprint.starter_command_desc": "把常用辦公步驟收成可複用指令。",
  "blueprint.starter_command_prompt":
    "幫我為此工作區創建一個可複用的辦公指令。先問我想固化什麼流程，再起草命令。",
  "blueprint.starter_command_title": "創建可複用指令",
  "blueprint.starter_connect_openai_desc":
    "先連接任意模型服務商（官方、相容 API 或本機模型），再開始對話。",
  "blueprint.starter_connect_openai_title": "連接你的模型",
  "blueprint.starter_csv_desc": "清洗、合併或生成表格資料。",
  "blueprint.starter_csv_prompt": "幫我在這台電腦上創建或編輯表格（CSV/Excel）。",
  "blueprint.starter_csv_title": "處理表格",
  "blueprint.starter_explore_desc": "彙總工作區文件並建議先辦哪件事。",
  "blueprint.starter_explore_prompt":
    "彙總此工作區裡的辦公材料，指出最重要的文件，並建議最適合先處理的任務。",
  "blueprint.starter_explore_title": "瀏覽工作區",
  "blueprint.welcome_message": `你好，歡迎使用 ${APP_NAME}。\n\n這是本地辦公工作台：任務與文件預設在本機，模型可自選（官方服務、相容 API 或本機模型）。\n\n常見起點：起草文檔與紀要、整理表格、定時自動化、從工作區文件繼續推進。\n\n還沒有模型時，請先在設定裡連接服務商；連上後即可直接派活。\n\n今天想先辦哪件事？`,
  "blueprint.welcome_title": `歡迎使用 ${APP_NAME}`,
} as const;
