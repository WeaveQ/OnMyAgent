/** @jsxImportSource react */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/app/index.css";
import {
  ImageGenerationToolCard,
} from "../src/react-app/domains/session/surface/specialized-tool-details";
import { TranscriptResourceChip } from "../src/react-app/domains/session/surface/transcript-resource-chip";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "../src/react-app/kernel/platform";

if (new URLSearchParams(window.location.search).get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

const generatedImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1e293b" />
        <stop offset="1" stop-color="#2563eb" />
      </linearGradient>
    </defs>
    <rect width="960" height="540" rx="24" fill="url(#background)" />
    <circle cx="760" cy="130" r="72" fill="#93c5fd" opacity="0.75" />
    <path d="M120 430 L330 220 L470 360 L600 250 L840 430 Z" fill="#e2e8f0" opacity="0.86" />
    <text x="52" y="72" fill="white" font-family="sans-serif" font-size="32">WorkBuddy image result</text>
  </svg>
`)}`;

function Fixture() {
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [generatingExpanded, setGeneratingExpanded] = useState(true);
  const [errorExpanded, setErrorExpanded] = useState(true);

  return (
    <main className="min-h-screen bg-dls-background px-10 py-8 text-dls-text">
      <div className="mx-auto max-w-[760px] space-y-8">
        <section className="space-y-3">
          <div className="flex justify-end">
            <div className="max-w-[70%] rounded-xl bg-dls-chat-user-bg px-4 py-3">
              <div className="mb-2 flex flex-wrap justify-end gap-2">
                <TranscriptResourceChip
                  filename="reference.pdf"
                  url="data:application/pdf;base64,"
                  mediaType="application/pdf"
                />
                <TranscriptResourceChip
                  filename="moodboard.png"
                  url={generatedImage}
                  mediaType="image/png"
                />
              </div>
              <p className="text-sm leading-6">Create an image from these references.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A quiet workspace at night with layered blue mountains",
              status: "completed",
              images: [{ url: generatedImage, base64: null, localPath: null }],
              errorMessage: null,
            }}
            running={false}
            expanded={completedExpanded}
            onToggle={() => setCompletedExpanded((value) => !value)}
          />
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A product illustration still being rendered",
              status: "generating",
              images: [],
              errorMessage: null,
            }}
            running
            expanded={generatingExpanded}
            onToggle={() => setGeneratingExpanded((value) => !value)}
          />
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A failed provider request",
              status: "error",
              images: [],
              errorMessage: "Provider unavailable",
            }}
            running={false}
            expanded={errorExpanded}
            onToggle={() => setErrorExpanded((value) => !value)}
          />
        </section>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");

createRoot(root).render(
  <PlatformProvider value={createDefaultPlatform()}>
    <Fixture />
  </PlatformProvider>,
);
