import type { ColorTheme, NavigationKey } from "@lpbot/api-contract";
import {
  ChevronDown,
  ChevronUp,
  Grid2X2,
  List,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sun,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { useUserPreferences } from "./preferences.js";
import { accentColorPresets } from "./theme.js";

const navigationLabels: Readonly<Record<NavigationKey, string>> = {
  activity: "日志",
  chat: "聊天室",
  pools: "池子",
  strategies: "策略",
  tasks: "任务",
  wallets: "钱包",
};

function SegmentedOption({
  checked,
  children,
  disabled,
  label,
  onSelect,
}: {
  checked: boolean;
  children: ReactNode;
  disabled: boolean;
  label: string;
  onSelect(): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="segmented-option"
      disabled={disabled}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function PreferenceSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="preference-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="preference-switch-thumb" />
    </button>
  );
}

function SettingRow({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="interface-setting-row">
      <div className="setting-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function InterfaceSettings() {
  const { preferences, resetNavigation, retryLoad, status, update } = useUserPreferences();
  const [customDraft, setCustomDraft] = useState(preferences.customColor ?? "#0F766E");
  const [customEditing, setCustomEditing] = useState(preferences.colorTheme === "custom");
  const [validationError, setValidationError] = useState<string | null>(null);
  const loading = status === "loading";

  useEffect(() => {
    if (preferences.customColor) setCustomDraft(preferences.customColor);
    setCustomEditing(preferences.colorTheme === "custom");
  }, [preferences.colorTheme, preferences.customColor]);

  const chooseColor = (colorTheme: ColorTheme) => {
    setValidationError(null);
    if (colorTheme === "custom") {
      setCustomEditing(true);
      return;
    }
    setCustomEditing(false);
    void update({ colorTheme });
  };

  const saveCustomColor = () => {
    const normalized = customDraft.toUpperCase();
    if (!/^#[0-9A-F]{6}$/u.test(normalized)) {
      setValidationError("请输入六位十六进制颜色，例如 #0F766E");
      return;
    }
    setValidationError(null);
    setCustomDraft(normalized);
    void update({ colorTheme: "custom", customColor: normalized });
  };

  const moveNavigation = (key: NavigationKey, direction: -1 | 1) => {
    const index = preferences.navConfig.findIndex((item) => item.key === key);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= preferences.navConfig.length) return;
    const navConfig = structuredClone(preferences.navConfig);
    const [item] = navConfig.splice(index, 1);
    navConfig.splice(destination, 0, item!);
    void update({ navConfig });
  };

  const navigationKeyDown = (event: KeyboardEvent<HTMLLIElement>, key: NavigationKey) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveNavigation(key, event.key === "ArrowUp" ? -1 : 1);
  };

  const statusText =
    status === "loading"
      ? "正在加载界面设置"
      : status === "saving"
        ? "正在保存界面设置"
        : status === "error"
          ? "界面设置加载失败"
          : "已同步";

  return (
    <section className="interface-settings" aria-labelledby="interface-settings-title">
      <div className="interface-section-heading">
        <div>
          <Palette aria-hidden="true" size={18} />
          <h2 id="interface-settings-title">界面</h2>
        </div>
        <div className="settings-sync-state">
          <span aria-label="界面设置状态" role="status">
            {statusText}
          </span>
          {status === "error" ? (
            <button className="compact-command" onClick={() => void retryLoad()} type="button">
              重试加载
            </button>
          ) : null}
        </div>
      </div>

      <div aria-busy={loading || status === "saving"} className="interface-settings-panel">
        <SettingRow description="选择界面的明暗模式" title="主题模式">
          <div aria-label="主题模式" className="segmented-control" role="radiogroup">
            <SegmentedOption
              checked={preferences.theme === "light"}
              disabled={loading}
              label="浅色"
              onSelect={() => void update({ theme: "light" })}
            >
              <Sun aria-hidden="true" size={15} />
            </SegmentedOption>
            <SegmentedOption
              checked={preferences.theme === "dark"}
              disabled={loading}
              label="深色"
              onSelect={() => void update({ theme: "dark" })}
            >
              <Moon aria-hidden="true" size={15} />
            </SegmentedOption>
            <SegmentedOption
              checked={preferences.theme === "system"}
              disabled={loading}
              label="系统"
              onSelect={() => void update({ theme: "system" })}
            >
              <Monitor aria-hidden="true" size={15} />
            </SegmentedOption>
          </div>
        </SettingRow>

        <div className="interface-setting-row color-setting-row">
          <div className="setting-copy">
            <h3>主题颜色</h3>
            <p>选择主题强调色</p>
          </div>
          <div className="color-setting-control">
            <div aria-label="主题颜色" className="color-swatches" role="radiogroup">
              {accentColorPresets.map((preset) => (
                <button
                  aria-checked={preferences.colorTheme === preset.key && !customEditing}
                  aria-label={preset.label}
                  className="color-swatch"
                  disabled={loading}
                  key={preset.key}
                  onClick={() => chooseColor(preset.key)}
                  role="radio"
                  style={{ "--swatch-color": preset.color } as CSSProperties}
                  title={preset.label}
                  type="button"
                >
                  <span aria-hidden="true" />
                </button>
              ))}
              <button
                aria-checked={preferences.colorTheme === "custom" || customEditing}
                aria-label="自定义颜色"
                className="color-swatch color-swatch-custom"
                disabled={loading}
                onClick={() => chooseColor("custom")}
                role="radio"
                title="自定义颜色"
                type="button"
              >
                <Palette aria-hidden="true" size={15} />
              </button>
            </div>
            {customEditing ? (
              <div className="custom-color-control">
                <span
                  aria-hidden="true"
                  className="custom-color-preview"
                  style={
                    /^#[0-9A-F]{6}$/iu.test(customDraft)
                      ? ({ "--swatch-color": customDraft } as CSSProperties)
                      : undefined
                  }
                />
                <input
                  aria-invalid={validationError ? "true" : undefined}
                  aria-label="自定义强调色"
                  disabled={loading}
                  maxLength={7}
                  onChange={(event) => setCustomDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveCustomColor();
                  }}
                  spellCheck={false}
                  type="text"
                  value={customDraft}
                />
                <button className="compact-command" onClick={saveCustomColor} type="button">
                  应用
                </button>
              </div>
            ) : null}
            {validationError ? <p role="alert">{validationError}</p> : null}
          </div>
        </div>

        <SettingRow description="默认展示方式" title="任务视图模式">
          <div aria-label="任务视图模式" className="segmented-control" role="radiogroup">
            <SegmentedOption
              checked={preferences.taskViewMode === "grid"}
              disabled={loading}
              label="网格"
              onSelect={() => void update({ taskViewMode: "grid" })}
            >
              <Grid2X2 aria-hidden="true" size={15} />
            </SegmentedOption>
            <SegmentedOption
              checked={preferences.taskViewMode === "list"}
              disabled={loading}
              label="列表"
              onSelect={() => void update({ taskViewMode: "list" })}
            >
              <List aria-hidden="true" size={15} />
            </SegmentedOption>
          </div>
        </SettingRow>

        <SettingRow description="在任务页显示池子侧边栏" title="侧边池子面板">
          <PreferenceSwitch
            checked={!preferences.poolsPanelCollapsed}
            disabled={loading}
            label="侧边池子面板"
            onChange={(visible) => void update({ poolsPanelCollapsed: !visible })}
          />
        </SettingRow>
        <SettingRow description="运行中无任务时显示热门池子" title="热门池子推荐">
          <PreferenceSwitch
            checked={preferences.showHotPools}
            disabled={loading}
            label="热门池子推荐"
            onChange={(checked) => void update({ showHotPools: checked })}
          />
        </SettingRow>
        <SettingRow description="在任务页显示扫描入口" title="扫描仓位">
          <PreferenceSwitch
            checked={preferences.showScanTab}
            disabled={loading}
            label="扫描仓位"
            onChange={(checked) => void update({ showScanTab: checked })}
          />
        </SettingRow>

        <div className="navigation-setting">
          <div className="navigation-setting-heading">
            <div className="setting-copy">
              <h3>导航栏</h3>
              <p>调整导航显示与顺序</p>
            </div>
            <button
              className="compact-command"
              disabled={loading}
              onClick={() => void resetNavigation()}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
              恢复默认导航
            </button>
          </div>
          <ul aria-label="导航排序与显示" className="navigation-preference-list">
            {preferences.navConfig.map((item, index) => {
              const label = navigationLabels[item.key];
              return (
                <li
                  key={item.key}
                  onKeyDown={(event) => navigationKeyDown(event, item.key)}
                  tabIndex={0}
                >
                  <div className="navigation-item-visibility">
                    <PreferenceSwitch
                      checked={item.visible}
                      disabled={loading || item.key === "tasks"}
                      label={`显示${label}`}
                      onChange={(visible) =>
                        void update({
                          navConfig: preferences.navConfig.map((current) =>
                            current.key === item.key ? { ...current, visible } : current,
                          ),
                        })
                      }
                    />
                    <span>{label}</span>
                    {item.key === "tasks" ? (
                      <LockKeyhole aria-label="任务入口已锁定" size={14} />
                    ) : null}
                  </div>
                  <div className="navigation-order-actions">
                    <button
                      aria-label={`${label}上移`}
                      className="icon-button"
                      disabled={loading || index === 0}
                      onClick={() => moveNavigation(item.key, -1)}
                      title="上移"
                      type="button"
                    >
                      <ChevronUp aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={`${label}下移`}
                      className="icon-button"
                      disabled={loading || index === preferences.navConfig.length - 1}
                      onClick={() => moveNavigation(item.key, 1)}
                      title="下移"
                      type="button"
                    >
                      <ChevronDown aria-hidden="true" size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
