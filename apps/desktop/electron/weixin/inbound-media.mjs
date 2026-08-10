import { downloadAndDecryptMedia, mediaReference, mediaUrlFromReference } from "./media.mjs";
import { mimeFromFilename } from "./helpers.mjs";

export function createInboundMediaCollector({ mediaFetchFn, mediaCacheDir, appendLog }) {
  async function collectMediaFiles(session, itemList) {
    const files = [];
    for (const item of itemList) {
      const direct = await collectMediaFile(session, item).catch((error) => {
        appendLog({ type: "error", text: `weixin media download failed: ${error.message}` });
        return null;
      });
      if (direct) files.push(direct);
      const refItem = item?.ref_msg?.message_item;
      if (refItem) {
        const ref = await collectMediaFile(session, refItem).catch(() => null);
        if (ref) files.push(ref);
      }
    }
    return files;
  }

  async function collectMediaFile(session, item) {
    if (item?.type === 1) return null;
    if (item?.type === 3 && item?.voice_item?.text) return null;
    const descriptor = mediaDescriptorForItem(session, item);
    if (!descriptor) return null;
    const outputPath = await downloadAndDecryptMedia({
      fetchFn: mediaFetchFn,
      url: descriptor.url,
      aesKey: descriptor.aesKey,
      outputDir: mediaCacheDir,
      filename: descriptor.filename,
    });
    return { path: outputPath, mimeType: descriptor.mimeType, kind: descriptor.kind };
  }

  function mediaDescriptorForItem(session, item) {
    if (item?.type === 2) {
      const media = mediaReference(item, "image_item");
      const aeskeyHex = String(item?.image_item?.aeskey ?? "").trim();
      return {
        kind: "image",
        mimeType: "image/jpeg",
        filename: `weixin-image-${Date.now()}.jpg`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: aeskeyHex ? Buffer.from(aeskeyHex, "hex").toString("base64") : media?.aes_key,
      };
    }
    if (item?.type === 4) {
      const fileItem = item?.file_item ?? {};
      const filename = String(fileItem.file_name ?? `weixin-file-${Date.now()}.bin`);
      const media = fileItem.media ?? {};
      return {
        kind: "file",
        mimeType: mimeFromFilename(filename),
        filename,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    if (item?.type === 5) {
      const media = mediaReference(item, "video_item");
      return {
        kind: "video",
        mimeType: "video/mp4",
        filename: `weixin-video-${Date.now()}.mp4`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    if (item?.type === 3) {
      const media = mediaReference(item, "voice_item");
      return {
        kind: "voice",
        mimeType: "audio/silk",
        filename: `weixin-voice-${Date.now()}.silk`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    return null;
  }

  return {
    collectMediaFiles,
    collectMediaFile,
    mediaDescriptorForItem,
  };
}
