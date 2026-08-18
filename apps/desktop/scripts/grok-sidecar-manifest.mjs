export const GROK_SIDECAR_VERSION = "1.0.1";

export const GROK_SIDECAR_SOURCE = Object.freeze({
  repository: "https://github.com/xai-org/grok-build.git",
  publicTreeCommit: "be713136d2a69080743a3f6b3c72077057e5948f",
  sourceRevision: "5d08d7e4123092567ccd584cd9f99afa2972065c",
  npmGitHead: "e9444c5615c050dea88141e4d30fe9c7fdac8aeb",
  license: "Apache-2.0",
});

const targets = {
  "aarch64-apple-darwin": {
    packageName: "@xai-official/grok-darwin-arm64",
    integrity: "sha512-oJPiy6MfHogUO53URMgOr8SA6R51KNDH2G1yC5C5MicCRRutvaHsYZFDTlImArUe55L+prtgTU+AP98vm7gDiw==",
    binarySha256: "535fc2dd1213b9324c05f2cff83714243d85c728c1e30de98c90b35d0c86aaf3",
    binarySize: 132_519_856,
    outputName: "grok-aarch64-apple-darwin",
  },
  "x86_64-apple-darwin": {
    packageName: "@xai-official/grok-darwin-x64",
    integrity: "sha512-XdTXBEhkddnhN5oGQfQ0cLK6V6pqMQ/mdbufd798HK8JBkp5QMYST+vlf6lDRwcFVOgbzkoxHoDoBZJLSiikgQ==",
    binarySha256: "717418f3ecf92d18f6f23e260398dbcb4d5d25053e867445fed7ff35e31d205f",
    binarySize: 148_102_128,
    outputName: "grok-x86_64-apple-darwin",
  },
  "x86_64-pc-windows-msvc": {
    packageName: "@xai-official/grok-win32-x64",
    integrity: "sha512-t2QmOfokIFG9RP5MJwSidCyzo5wAFlX16M0sIt9kNjzXls/rhLgIkzCd61+mrT9g5FNPYAFNzEFTPgWS6OD6Yw==",
    binarySha256: "3a83e4c4d4b3b9400e42bd91a4006e6e60bc65978b0ec775433f0c412a0edcfd",
    binarySize: 140_616_520,
    outputName: "grok-x86_64-pc-windows-msvc.exe",
  },
  "aarch64-pc-windows-msvc": {
    packageName: "@xai-official/grok-win32-arm64",
    integrity: "sha512-7X6cxIncRcR2RBqanhF98WdrzGccw1boOZy0mwspwhVn9LF6HP06zD56cWtRU4Wpzxf7qakUDjQLSU4vjYCFmw==",
    binarySha256: "2fa8c76d44eaaec66bc747f775f5e704d274e846459a04f2c3ec9273a4651905",
    binarySize: 122_126_664,
    outputName: "grok-aarch64-pc-windows-msvc.exe",
  },
};

export const GROK_SIDECAR_TARGETS = Object.freeze(targets);
export const GROK_THIRD_PARTY_NOTICES_SHA256 =
  "e8785a6098a7ee780cd2db35745b8e53061cfb1b6da19147a308579466ea4e50";

export function grokSidecarSpec(targetTriple) {
  const target = GROK_SIDECAR_TARGETS[targetTriple];
  if (!target) return null;
  const archiveName = target.packageName.split("/").at(-1);
  return {
    ...target,
    targetTriple,
    version: GROK_SIDECAR_VERSION,
    tarballUrl: `https://registry.npmjs.org/${target.packageName}/-/${archiveName}-${GROK_SIDECAR_VERSION}.tgz`,
  };
}
