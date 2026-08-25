import { describe, expect, test } from "bun:test";
import { compileMinimalGrokExpertProfile } from "../src/services/grok-expert-profile-compiler.js";

describe("compileMinimalGrokExpertProfile", () => {
  test("disables eager/global inheritance and includes only activated declared skills", () => {
    const compiled = compileMinimalGrokExpertProfile({
      expertId: "expert-a",
      description: "Fixture expert",
      systemPrompt: "You are the fixture Expert.",
      declaredSkillNames: ["heavy-a", "heavy-b"],
      activatedSkillNames: ["heavy-b"],
      allowedBuiltInToolIds: ["GrokBuild:read_file", "GrokBuild:grep"],
    });
    expect(compiled.materializedSkillNames).toEqual(["heavy-a", "heavy-b"]);
    expect(compiled.agentProfile).toMatchObject({
      promptMode: "full",
      permissionMode: "default",
      discoverSkills: false,
      inheritSkills: false,
      injectDefaultTools: false,
      agentsMd: false,
      skills: ["heavy-b"],
      mcpInheritance: "none",
    });
    expect(compiled.agentProfile.toolConfig.tools.map((tool) => tool.id)).toEqual([
      "GrokBuild:grep",
      "GrokBuild:read_file",
    ]);
  });

  test("uses no skills by default and rejects undeclared activation", () => {
    expect(compileMinimalGrokExpertProfile({
      expertId: "expert-a",
      description: "Fixture expert",
      systemPrompt: "Prompt",
      declaredSkillNames: ["heavy"],
      allowedBuiltInToolIds: [],
    }).materializedSkillNames).toEqual(["heavy"]);
    expect(() => compileMinimalGrokExpertProfile({
      expertId: "expert-a",
      description: "Fixture expert",
      systemPrompt: "Prompt",
      declaredSkillNames: ["declared"],
      activatedSkillNames: ["foreign"],
      allowedBuiltInToolIds: [],
    })).toThrow(expect.objectContaining({ code: "grok_expert_skill_not_declared" }));
  });
});
