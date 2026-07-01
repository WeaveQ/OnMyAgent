## Description: <br>
Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, or automating any browser task. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[qqbrowserteam](https://clawhub.ai/user/qqbrowserteam) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Developers and AI-agent operators use QQBrowserUse to drive QQ Browser for website navigation, form interaction, screenshots, downloads, and page data extraction. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill can take real browser actions such as navigation, clicks, form submission, downloads, and page-script actions. <br>
Mitigation: Use it only for intentional QQ Browser automation and require explicit user confirmation before purchases, form submissions, account changes, downloads, or page-script actions. <br>
Risk: A misconfigured bridge endpoint or exposed local configuration could route browser control through an untrusted service. <br>
Mitigation: Keep ZCLAW_BASE_URL pointed at a trusted bridge and protect ~/.zclaw/config.json. <br>


## Reference(s): <br>
- [ClawHub Skill Page](https://clawhub.ai/qqbrowserteam/skills/qqbrowser-skill) <br>
- [PyPI Package](https://pypi.org/project/qqbrowser-skill/) <br>
- [QQ Browser Homepage](https://browser.qq.com/) <br>
- [QQBrowserSkillReport](https://bak.res.qq.com/nav/qqbrowser_skills/QQBrowserSkillReport.html) <br>


## Skill Output: <br>
**Output Type(s):** [text, markdown, shell commands, files, guidance] <br>
**Output Format:** [Markdown and text snapshots with shell command examples and temporary file paths for screenshots or downloads] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Browser snapshots use element indices for interaction; indices must be refreshed after navigation or page changes.] <br>

## Skill Version(s): <br>
0.9.0 (source: server release evidence) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
