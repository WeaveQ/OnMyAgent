import { describe, expect, test } from "bun:test";

import { resolveMarketplaceExpertStartPrompt } from "../src/react-app/domains/session/expert-marketplace/start-prompt";

const firstTemplate = {
  id: "organize",
  title: "整理资料",
  description: "整理成一张表",
  template: "请把 <客户资料> 整理成 <我的模板>。",
  requiredSlots: ["客户资料"],
  conditionalSlots: ["我的模板"],
};

describe("marketplace expert start prompt", () => {
  test("default summon prefills the first editable template", () => {
    expect(
      resolveMarketplaceExpertStartPrompt({
        packageName: "order-dispatch-specialist",
        promptTemplates: [firstTemplate],
        quickPrompts: ["普通示例"],
      }),
    ).toEqual({
      prompt: firstTemplate.template,
      template: true,
    });
  });

  test("an explicitly selected example remains the chosen prompt", () => {
    expect(
      resolveMarketplaceExpertStartPrompt(
        {
          packageName: "order-dispatch-specialist",
          promptTemplates: [firstTemplate],
          quickPrompts: ["普通示例"],
        },
        "  用户点选的示例  ",
      ),
    ).toEqual({
      prompt: "用户点选的示例",
      template: false,
    });
  });

  test("falls back to the first quick prompt when no template exists", () => {
    expect(
      resolveMarketplaceExpertStartPrompt({
        packageName: "order-dispatch-specialist",
        promptTemplates: [],
        quickPrompts: ["  先告诉我你的需求  "],
      }),
    ).toEqual({
      prompt: "先告诉我你的需求",
      template: false,
    });
  });

  test("does not change the default summon behavior of unrelated experts", () => {
    expect(
      resolveMarketplaceExpertStartPrompt({
        packageName: "recruitment-specialist",
        promptTemplates: [firstTemplate],
        quickPrompts: ["普通示例"],
      }),
    ).toBeNull();
  });
});
