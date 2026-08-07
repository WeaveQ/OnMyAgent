## Description: <br>
Downloads and merges online videos from Bilibili, Douyin, and YouTube when the user provides a video URL. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[roykingw](https://clawhub.ai/user/roykingw) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
External users and developers can use this skill to invoke a local video-downloader script for a supplied video URL and receive the script's status output. The skill may save downloaded MP4 files to the local Downloads folder. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill can automatically install or upgrade local software through package managers. <br>
Mitigation: Review before installing, run in a contained environment where possible, or preinstall yt-dlp and ffmpeg manually. <br>
Risk: The skill downloads content from a user-provided URL and saves output to the local Downloads folder. <br>
Mitigation: Use only trusted URLs and confirm that local download storage and content rights are appropriate before execution. <br>


## Reference(s): <br>
- [ClawHub skill page](https://clawhub.ai/roykingw/yt-dlp-downloader) <br>
- [Publisher profile](https://clawhub.ai/user/roykingw) <br>


## Skill Output: <br>
**Output Type(s):** [text, shell commands, files] <br>
**Output Format:** [Plain text command output and local MP4 files] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [The script accepts one video URL and may run for up to 10 minutes.] <br>

## Skill Version(s): <br>
1.0.0 (source: server release evidence and skill frontmatter) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
