import { DEFAULT_CLEAN_REPO_PROMPT } from "@t3tools/contracts";
import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function CleanRepoPromptSettings() {
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["cleanRepoPrompt"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["cleanRepoPrompt"]}
      {...searchableSetting("clean-repo-prompt")}
      description="The message Clean Repo sends to its agent. Clear it to use the default."
      resetAction={
        mixed || settings.cleanRepoPrompt !== "" ? (
          <SettingResetButton
            label="Clean Repo prompt"
            onClick={() => updateSettings({ cleanRepoPrompt: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.cleanRepoPrompt}`}
          aria-label="Clean Repo prompt"
          onChange={() => {
            edited.current = true;
          }}
          rows={5}
          defaultValue={mixed ? "" : settings.cleanRepoPrompt || DEFAULT_CLEAN_REPO_PROMPT}
          placeholder={
            mixed
              ? "Mixed. Enter a prompt to apply to all selected targets."
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
