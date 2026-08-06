/**
 * Icons for product bundled skills (resources/bundled-skills).
 * Used by 已安装 → 内置 cards when the skill is not also in the marketplace catalog.
 */
import browserAutomation from "../../../../../../desktop/resources/bundled-skills/browser-automation/_icon.png?url";
import browserSkill from "../../../../../../desktop/resources/bundled-skills/browser-skill/_icon.png?url";
import canvasDesign from "../../../../../../desktop/resources/bundled-skills/canvas-design/_icon.png?url";
import computerUse from "../../../../../../desktop/resources/bundled-skills/computer-use/_icon.png?url";
import createAutomation from "../../../../../../desktop/resources/bundled-skills/create-automation/_icon.png?url";
import docCoauthoring from "../../../../../../desktop/resources/bundled-skills/doc-coauthoring/_icon.png?url";
import documentProcessing from "../../../../../../desktop/resources/bundled-skills/document-processing/_icon.png?url";
import expertManager from "../../../../../../desktop/resources/bundled-skills/expert-manager/_icon.png?url";
import findSkills from "../../../../../../desktop/resources/bundled-skills/find-skills/_icon.png?url";
import pptx from "../../../../../../desktop/resources/bundled-skills/pptx/_icon.png?url";
import qccCompany from "../../../../../../desktop/resources/bundled-skills/qcc-company/_icon.png?url";
import selfImproving from "../../../../../../desktop/resources/bundled-skills/self-improving/_icon.png?url";
import skillCreator from "../../../../../../desktop/resources/bundled-skills/skill-creator/_icon.png?url";
import tencentDocs from "../../../../../../desktop/resources/bundled-skills/tencent-docs/_icon.png?url";
import tencentMeeting from "../../../../../../desktop/resources/bundled-skills/tencent-meeting-skill/_icon.png?url";
import weather from "../../../../../../desktop/resources/bundled-skills/weather/_icon.png?url";
import wecomUnified from "../../../../../../desktop/resources/bundled-skills/wecom-unified/_icon.png?url";

export const BUNDLED_SKILL_ICON_URLS: Record<string, string> = {
  "browser-automation": browserAutomation,
  "browser-skill": browserSkill,
  "canvas-design": canvasDesign,
  "computer-use": computerUse,
  "create-automation": createAutomation,
  "doc-coauthoring": docCoauthoring,
  "document-processing": documentProcessing,
  "expert-manager": expertManager,
  "find-skills": findSkills,
  pptx,
  "qcc-company": qccCompany,
  "self-improving": selfImproving,
  "skill-creator": skillCreator,
  "tencent-docs": tencentDocs,
  "tencent-meeting-skill": tencentMeeting,
  weather,
  "wecom-unified": wecomUnified,
};
