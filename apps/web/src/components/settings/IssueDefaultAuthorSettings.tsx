import type { IssueDefaultAuthor, SourceControlProviderDiscoveryItem } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { activeGithubLogin, githubAccounts } from "../issues/issues.logic";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const LOGIN_PREFIX = "login:";

const toValue = (setting: IssueDefaultAuthor) =>
  typeof setting === "string" ? setting : `${LOGIN_PREFIX}${setting.login}`;

const fromValue = (value: string): IssueDefaultAuthor =>
  value === "active-account" || value === "all"
    ? value
    : { login: value.slice(LOGIN_PREFIX.length) };

/** `providers` belong to one environment, so fixed logins are offered only when it is the only one in scope. */
export function IssueDefaultAuthorSettingsSection({
  providers,
  singleEnvironment,
}: {
  readonly providers: ReadonlyArray<SourceControlProviderDiscoveryItem>;
  readonly singleEnvironment: boolean;
}) {
  const setting = useScopedSettings((settings) => settings.issueDefaultAuthor);
  const mixed = useScopedSettingsMixed(["issueDefaultAuthor"]);
  const updateSettings = useUpdateScopedSettings();
  const activeLogin = singleEnvironment ? activeGithubLogin(providers) : undefined;
  const logins = [
    ...new Set([
      ...(singleEnvironment ? githubAccounts(providers).map(({ account }) => account) : []),
      ...(typeof setting === "string" ? [] : [setting.login]),
    ]),
  ].toSorted((left, right) => left.localeCompare(right));
  const label = (value: IssueDefaultAuthor) =>
    value === "active-account"
      ? activeLogin === undefined
        ? "Active gh account"
        : `Active gh account (${activeLogin})`
      : value === "all"
        ? "All authors"
        : value.login;
  const options: ReadonlyArray<IssueDefaultAuthor> = [
    "active-account",
    ...logins.map((login) => ({ login })),
    "all",
  ];
  const isDefault = toValue(setting) === toValue(DEFAULT_UNIFIED_SETTINGS.issueDefaultAuthor);

  return (
    <SettingsSection title="Issues">
      <SettingsRow
        serverScoped
        settingKeys={["issueDefaultAuthor"]}
        mixed={mixed}
        {...searchableSetting("issue-default-author")}
        description={
          singleEnvironment
            ? "Who a thread's Issues tab filters by when it opens. Picking another author in the tab lasts while it shows."
            : "Who a thread's Issues tab filters by when it opens. Choose one environment to pick a fixed login from its gh accounts."
        }
        resetAction={
          isDefault ? null : (
            <SettingResetButton
              label="default issue author"
              onClick={() =>
                updateSettings({ issueDefaultAuthor: DEFAULT_UNIFIED_SETTINGS.issueDefaultAuthor })
              }
            />
          )
        }
        control={
          <Select
            value={toValue(setting)}
            onValueChange={(value) => {
              if (typeof value === "string")
                updateSettings({ issueDefaultAuthor: fromValue(value) });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Default issue author">
              <SelectValue>{mixed ? "Mixed" : label(setting)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map((option) => (
                <SelectItem hideIndicator key={toValue(option)} value={toValue(option)}>
                  {label(option)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
