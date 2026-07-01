import { APP_NAME } from "../brand";

export default {
  "blueprint.automation_body": "從可複用的工作流開始，或在下方輸入你的任務。",
  "blueprint.automation_title": "你想自動化什麼？",
  "blueprint.csv_session_assistant":
    "我可以幫你生成、清洗、合併和彙總CSV文件。你想自動化哪種CSV工作？",
  "blueprint.csv_session_title": "CSV工作流創意",
  "blueprint.csv_session_user": "我想把多個工具的導出合併成一個整潔的CSV。",
  "blueprint.empty_body": "選擇一個起點，或直接在下方輸入。",
  "blueprint.empty_title": "你想做什麼？",
  "blueprint.minimal_body": "詢問關於此工作區的問題，或使用啟動提示詞。",
  "blueprint.minimal_title": "從一個任務開始",
  "blueprint.starter_blueprint_desc":
    "設計一個包含skills、命令和交接步驟的可複用工作流。",
  "blueprint.starter_blueprint_prompt":
    "幫我為此工作區設計一個可複用的自動化藍圖。先問我想標準化什麼，然後提出工作流方案。",
  "blueprint.starter_blueprint_title": "規劃自動化藍圖",
  "blueprint.starter_chrome_desc": "立即開始瀏覽器自動化對話。",
  "blueprint.starter_chrome_prompt": "使用內置瀏覽器自動化一個重複性網頁任務。",
  "blueprint.starter_chrome_title": "瀏覽器自動化",
  "blueprint.starter_command_desc": "將重複的工作流轉化為此工作區的斜槓命令。",
  "blueprint.starter_command_prompt":
    "幫我為此工作區創建一個可複用的/command。先問我想自動化什麼工作流，然後起草命令。",
  "blueprint.starter_command_title": "創建可複用命令",
  "blueprint.starter_connect_openai_desc":
    "添加 OpenAI 模型服務商，讓 ChatGPT 模型在新會話中即可使用。",
  "blueprint.starter_connect_openai_title": "連接ChatGPT",
  "blueprint.starter_csv_desc": "清洗或生成電子表格數據。",
  "blueprint.starter_csv_prompt": "幫我在這臺電腦上創建或編輯CSV文件。",
  "blueprint.starter_csv_title": "處理CSV",
  "blueprint.starter_explore_desc": "彙總文件並建議最適合先處理的任務。",
  "blueprint.starter_explore_prompt":
    "彙總此工作區，指出最重要的文件，並建議最適合先處理的任務。",
  "blueprint.starter_explore_title": "探索此工作區",
  "blueprint.welcome_message": `你好，歡迎使用${APP_NAME}！\n\n大家用${APP_NAME}在電腦上編寫CSV文件、自動化瀏覽器任務，以及將聯繫人同步到Notion。\n\n但唯一的限制是你的想象力。\n\n你想做什麼？`,
  "blueprint.welcome_title": `歡迎使用${APP_NAME}`,
} as const;
