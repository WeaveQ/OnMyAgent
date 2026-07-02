## Description: <br>
Tencent Cloud COS integrates object storage, CI data processing, MetaInsight multimodal retrieval, and knowledge-base setup for file storage, media processing, content review, and document search workflows. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[shawnminh](https://clawhub.ai/user/shawnminh) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Developers and operators use this skill to let an agent manage Tencent Cloud COS buckets and objects, run Tencent CI processing jobs, create searchable knowledge bases, and retrieve storage or processing results. It is intended for users who already plan to grant the agent scoped Tencent Cloud access. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill can give an agent broad Tencent Cloud COS and CI authority, including uploads, signed links, deletes, ACL/CORS changes, knowledge-base creation, document indexing, and generic CI requests. <br>
Mitigation: Install it only when those cloud operations are intended, grant a least-privilege Tencent sub-account or STS token, and require explicit confirmation before mutating or exposing resources. <br>
Risk: Tencent Cloud credentials are required and may be long-lived if permanent keys are used. <br>
Mitigation: Prefer STS temporary credentials, avoid root account keys, keep credentials in ephemeral environment variables when possible, and never echo SecretId or SecretKey in chat. <br>
Risk: COS and CI operations can incur Tencent Cloud fees. <br>
Mitigation: Review the Tencent Cloud COS and CI fee documentation before enabling uploads, processing jobs, media conversion, content review, indexing, or knowledge-base workflows. <br>


## Reference(s): <br>
- [ClawHub release page](https://clawhub.ai/shawnminh/tencentcloud-cos) <br>
- [COS Node.js SDK Operation Reference](references/api_reference.md) <br>
- [Tencent Cloud COS Node.js SDK](https://cloud.tencent.com/document/product/436/8629) <br>
- [Tencent Cloud CI Documentation](https://cloud.tencent.com/document/product/460) <br>
- [Tencent Cloud COS Fees](https://cloud.tencent.com/document/product/436/16871) <br>
- [Tencent Cloud CI Fees](https://cloud.tencent.com/document/product/460/6970) <br>


## Skill Output: <br>
**Output Type(s):** [text, markdown, code, shell commands, configuration, guidance] <br>
**Output Format:** [Markdown guidance with shell command examples and JSON command results] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Commands may upload, download, delete, index, or process cloud objects and may create or modify local credential files when persistent setup is chosen.] <br>

## Skill Version(s): <br>
1.1.6 (source: ClawHub release evidence) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
