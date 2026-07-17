import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useState } from "react";
import { CheckCircle2, Loader2, Mic2, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  registerExtensionConfig,
  type ExtensionConfigContext,
} from "./extension-registry";
import { t } from "@/i18n";
import { APP_NAME } from "../../../i18n/locales/brand";

export type OnMyAgentVoiceConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onSaveApiKey: (apiKey: string) => void | Promise<void>;
  onTestSession: () => void | Promise<void>;
};

const openWorkVoiceConfigFactory = (ctx: ExtensionConfigContext) => (
  <OnMyAgentVoiceConfig
    busy={ctx.voiceExtension.busy}
    status={ctx.voiceExtension.status}
    error={ctx.voiceExtension.error}
    envKeyDetected={ctx.voiceExtension.envKeyDetected}
    onSaveApiKey={ctx.voiceExtension.onSaveApiKey}
    onTestSession={ctx.voiceExtension.onTestSession}
  />
);

registerExtensionConfig("onmyagent.voice.settings", openWorkVoiceConfigFactory);
registerExtensionConfig("onmyagent-voice", openWorkVoiceConfigFactory);

export function OnMyAgentVoiceConfig(props: OnMyAgentVoiceConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const canSave = Boolean(apiKey.trim());

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{t("extensions.voice_realtime_title")}</CardTitle>
        <CardDescription>
          {t("extensions.voice_realtime_desc", { app: APP_NAME })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.envKeyDetected ? (
          <Alert>
            <Mic2 />
            <AlertTitle>{t("extensions.openai_key_detected")}</AlertTitle>
            <AlertDescription>
              {t("extensions.voice_env_key_desc", { app: APP_NAME })}
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="onmyagent-voice-api-key">
              OpenAI API key
            </FieldLabel>
            <Input
              id="onmyagent-voice-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="sk-..."
            />
            <FieldDescription>
              Saved as OPENAI_API_KEY in {APP_NAME}'s local env store. The
              renderer only receives short-lived Realtime client secrets.
            </FieldDescription>
          </Field>
        </FieldGroup>

        {props.status ? (
          <Alert>
            <CheckCircle2 className="text-dls-accent" />
            <AlertDescription>{props.status}</AlertDescription>
          </Alert>
        ) : null}
        {props.error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap gap-2 border-t border-dls-border justify-between">
        <Button
          onClick={() => void props.onSaveApiKey(apiKey)}
          disabled={props.busy || !canSave}
        >
          {props.busy ? (
            <LoadingSpinner size="sm" data-icon="inline-start" />
          ) : null}
          Save key
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onTestSession()}
          disabled={props.busy || !props.envKeyDetected}
        >
          Test Realtime
        </Button>
      </CardFooter>
    </Card>
  );
}
