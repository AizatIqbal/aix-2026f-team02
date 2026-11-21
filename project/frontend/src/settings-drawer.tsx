import { useEffect, useState, type ReactNode } from "react";
import { useModalScrollLock, Icon } from "./ui";
import {
  usePreferences,
  type AppLanguage,
  type AppTheme,
  type AppCurrency,
  type AppDisplaySize,
  type AppMode,
} from "./preferences";

type SettingSection = "mode" | "language" | "currency" | "appearance" | "display";

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const {
    appMode,
    language,
    theme,
    currency,
    displaySize,
    setAppMode,
    setLanguage,
    setTheme,
    setCurrency,
    setDisplaySize,
    exchangeRateStatus,
    exchangeRateDate,
    exchangeRateError,
    t,
  } = usePreferences();
  const [expandedSection, setExpandedSection] = useState<SettingSection | null>(null);
  useModalScrollLock();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function toggleSection(section: SettingSection) {
    setExpandedSection((current) => current === section ? null : section);
  }

  function selectAndCollapse(action: () => void) {
    action();
    setExpandedSection(null);
  }

  function languageOption(value: AppLanguage, title: string, subtitle: string) {
    const selected = language === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectAndCollapse(() => setLanguage(value))}
        aria-pressed={selected}
        className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`mt-0.5 block text-xs ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{subtitle}</span>
        </span>
        {selected && <Icon name="check" className="size-5" />}
      </button>
    );
  }

  function currencyOption(value: AppCurrency, title: string, subtitle: string) {
    const selected = currency === value;
    const disabled = value !== "KRW" && exchangeRateStatus !== "ready";
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectAndCollapse(() => setCurrency(value))}
        disabled={disabled}
        aria-pressed={selected}
        className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`mt-0.5 block text-xs ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{subtitle}</span>
        </span>
        {selected && <Icon name="check" className="size-5" />}
      </button>
    );
  }

  function modeOption(value: AppMode, title: string, description: string) {
    const selected = appMode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectAndCollapse(() => setAppMode(value))}
        aria-pressed={selected}
        className={`flex min-h-[76px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`mt-1 block text-xs leading-5 ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{description}</span>
        </span>
        {selected && <Icon name="check" className="size-5 shrink-0" />}
      </button>
    );
  }

  function themeOption(value: AppTheme, title: string, subtitle: string, icon: "sun" | "moon") {
    const selected = theme === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectAndCollapse(() => setTheme(value))}
        aria-pressed={selected}
        className={`flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <Icon name={icon} className="size-5 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`mt-0.5 block text-xs ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{subtitle}</span>
        </span>
        {selected && <Icon name="check" className="ml-auto size-4 shrink-0" />}
      </button>
    );
  }

  function displaySizeOption(value: AppDisplaySize, title: string, description: string, sampleClass: string) {
    const selected = displaySize === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectAndCollapse(() => setDisplaySize(value))}
        aria-pressed={selected}
        className={`flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <span className={`${sampleClass} font-bold leading-none`}>Aa</span>
        <span className="text-xs font-semibold">{title}</span>
        <span className={`text-[10px] leading-tight ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{description}</span>
        {selected && <Icon name="check" className="mt-0.5 size-4" />}
      </button>
    );
  }

  function settingRow(
    section: SettingSection,
    title: string,
    currentValue: string,
    content: ReactNode,
  ) {
    const expanded = expandedSection === section;
    const panelId = `settings-${section}-options`;
    return (
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={() => toggleSection(section)}
          className="flex min-h-[68px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-strong/70 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-ink">{title}</span>
            <span className="mt-1 block truncate text-xs text-ink-muted">{currentValue}</span>
          </span>
          <Icon name="chevron" className={`size-5 shrink-0 text-ink-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded && (
          <div id={panelId} className="space-y-3 border-t border-line px-4 py-4">
            {content}
          </div>
        )}
      </section>
    );
  }

  const modeSummary = t(appMode === "simple" ? "Simple Mode" : "Advanced Mode");
  const languageSummary = language === "en" ? "English" : "한국어";
  const currencySummary = currency === "KRW"
    ? "KRW · ₩"
    : currency === "USD"
      ? "USD · $"
      : "MYR · RM";
  const appearanceSummary = t(theme === "light" ? "Light" : "Dark");
  const displaySummary = t(displaySize === "compact" ? "Compact" : displaySize === "large" ? "Large" : "Default");

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-ink/35 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-2xl animate-[settings-slide-in_180ms_ease-out] sm:max-w-md"
      >
        <header className="flex shrink-0 items-start justify-between border-b border-line bg-white px-5 py-5 sm:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{t("PointNull preferences")}</div>
            <h2 id="settings-title" className="mt-1 font-display text-2xl font-bold text-ink">{t("Settings")}</h2>
            <p className="mt-1 text-xs text-ink-muted">{t("Your preferences are saved on this device.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close settings")} className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {settingRow(
            "mode",
            t("App Mode"),
            modeSummary,
            <>
              <p className="text-xs leading-5 text-ink-muted">{t("Choose the workspace that fits your business needs.")}</p>
              <p className="rounded-xl bg-surface-strong px-3 py-2 text-xs leading-5 text-ink-muted">{t("Simple Mode keeps selling and order history visible. Advanced Mode adds Analysis, Marketing, Customers, and Import.")}</p>
              <p className="text-xs leading-5 text-ink-faint">{t("Switching modes only changes which tools appear. Your existing data remains saved.")}</p>
              <div className="space-y-2">
                {modeOption("simple", t("Simple Mode"), t("Essential tools for daily sales."))}
                {modeOption("advanced", t("Advanced Mode"), t("Full tools for growing businesses."))}
              </div>
            </>,
          )}

          {settingRow(
            "language",
            t("Language / 언어"),
            languageSummary,
            <>
              <p className="text-xs leading-5 text-ink-muted">{t("Choose your preferred language.")}</p>
              <div className="space-y-2">
                {languageOption("en", "🇬🇧 English", "영어")}
                {languageOption("ko", "🇰🇷 한국어", "Korean")}
              </div>
            </>,
          )}

          {settingRow(
            "currency",
            t("Currency / 통화"),
            currencySummary,
            <>
              <p className="text-xs leading-5 text-ink-muted">{t("Choose your preferred display currency.")}</p>
              <div className="space-y-2">
                {currencyOption("KRW", t("KRW · Korean Won"), `₩ · ${t("Base currency")}`)}
                {currencyOption("USD", t("USD · US Dollar"), `$ · ${t("US Dollar")}`)}
                {currencyOption("MYR", t("MYR · Malaysian Ringgit"), `RM · ${t("Malaysian Ringgit")}`)}
              </div>
              <p className="text-xs leading-5 text-ink-muted">{t("Currency conversion is for display only. All transactions are recorded in KRW.")}</p>
              {exchangeRateStatus === "loading" && (
                <p role="status" className="text-xs text-ink-muted">{t("Loading exchange rates…")}</p>
              )}
              {exchangeRateDate && (
                <p className="text-xs text-ink-faint">
                  {t("Reference rates updated")} {exchangeRateDate} · <a className="underline underline-offset-2 hover:text-accent" href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a>
                </p>
              )}
              {exchangeRateError && (
                <p role="status" className="text-xs text-ink-muted">{t(exchangeRateError)}</p>
              )}
            </>,
          )}

          {settingRow(
            "appearance",
            t("Appearance"),
            appearanceSummary,
            <>
              <p className="text-xs leading-5 text-ink-muted">{t("Choose how PointNull looks.")}</p>
              <div className="flex gap-2">
                {themeOption("light", t("Light"), t("Bright workspace"), "sun")}
                {themeOption("dark", t("Dark"), t("Low-light workspace"), "moon")}
              </div>
            </>,
          )}

          {settingRow(
            "display",
            t("Display size"),
            displaySummary,
            <>
              <p className="text-xs leading-5 text-ink-muted">{t("Adjust spacing and text size.")}</p>
              <div className="grid grid-cols-3 gap-2">
                {displaySizeOption("compact", t("Compact"), t("More content"), "text-sm")}
                {displaySizeOption("default", t("Default"), t("Balanced layout"), "text-lg")}
                {displaySizeOption("large", t("Large"), t("Easier to read"), "text-2xl")}
              </div>
            </>,
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-white px-5 py-4 text-xs text-ink-faint sm:px-6">
          {t("PointNull")} · {t("Settings")}
        </footer>
      </aside>
    </div>
  );
}
