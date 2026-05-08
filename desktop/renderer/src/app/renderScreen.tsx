import type { RenderProps } from "./types";
import { MainDone, MainEmpty, MainFiles, MainGenerating, MainMissing, OutputConflict } from "./screens/main";
import { QueueDetail, QueueList } from "./screens/queue";
import { SettingsPage } from "./screens/settings";
import { SetupCheck, SetupDone } from "./screens/setup";
import { ToolBurnIn, ToolTranslate } from "./screens/tools";

export function renderScreen(props: RenderProps) {
  switch (props.screen) {
    case "setup-check":
      return <SetupCheck {...props} />;
    case "setup-done":
      return <SetupDone {...props} />;
    case "main-empty":
      return <MainEmpty {...props} />;
    case "main-files":
      return <MainFiles {...props} advanced={false} />;
    case "main-advanced":
      return <MainFiles {...props} advanced />;
    case "main-missing":
      return <MainMissing {...props} />;
    case "main-conflict":
      return <OutputConflict {...props} />;
    case "main-generating":
      return <MainGenerating {...props} />;
    case "main-done":
      return <MainDone {...props} />;
    case "queue-list":
      return <QueueList {...props} />;
    case "queue-detail":
      return <QueueDetail {...props} failed={false} />;
    case "queue-failed":
      return <QueueDetail {...props} failed />;
    case "settings-general":
      return <SettingsPage {...props} tab="general" />;
    case "settings-models":
      return <SettingsPage {...props} tab="models" />;
    case "settings-api":
      return <SettingsPage {...props} tab="api" />;
    case "settings-providers":
      return <SettingsPage {...props} tab="providers" />;
    case "settings-diagnostics":
      return <SettingsPage {...props} tab="diagnostics" />;
    case "settings-benchmark":
      return <SettingsPage {...props} tab="benchmark" />;
    case "tool-translate":
      return <ToolTranslate {...props} />;
    case "tool-burn-in":
      return <ToolBurnIn {...props} />;
    default:
      return <MainEmpty {...props} />;
  }
}
