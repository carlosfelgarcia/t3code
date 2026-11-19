import { DEFAULT_CLEAN_REPO_PROMPT } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function CleanRepoPromptSettings() {
  const gt = useGT();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["cleanRepoPrompt"]);
  const setting = useSearchableSetting();

  return (
    <SettingsRow
      serverScoped
      settingKeys={["cleanRepoPrompt"]}
      {...setting("clean-repo-prompt")}
      description={gt("The message Clean Repo sends to its agent. Clear it to use the default.")}
      resetAction={
        mixed || settings.cleanRepoPrompt !== "" ? (
          <SettingResetButton
            ariaLabel={gt("Reset Clean Repo prompt to default")}
            onClick={() => updateSettings({ cleanRepoPrompt: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.cleanRepoPrompt}`}
          aria-label={gt("Clean Repo prompt")}
          onChange={() => {
            edited.current = true;
          }}
          rows={5}
          defaultValue={mixed ? "" : settings.cleanRepoPrompt || DEFAULT_CLEAN_REPO_PROMPT}
          placeholder={
            mixed
              ? gt("Mixed. Enter a prompt to apply to all selected targets.")
              : DEFAULT_CLEAN_REPO_PROMPT
          }
          onBlur={(event) => {
            const typed = event.target.value.trim();
            const value = typed === DEFAULT_CLEAN_REPO_PROMPT ? "" : typed;
            if (edited.current && (mixed || value !== settings.cleanRepoPrompt))
              updateSettings({ cleanRepoPrompt: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
