import { useEffect } from "react";
import { useModalScrollLock, Icon } from "./ui";
import { usePreferences, type AppLanguage, type AppTheme, type AppCurrency } from "./preferences";

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const { language, theme, currency, setLanguage, setTheme, setCurrency, exchangeRateStatus, exchangeRateDate, exchangeRateError, t } = usePreferences();
  useModalScrollLock();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function languageOption(value: AppLanguage, title: string, subtitle: string) {
    const selected = language === value;
    return (
      <button
        type="button"
        onClick={() => setLanguage(value)}
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
        type="button"
        onClick={() => setCurrency(value)}
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

  function themeOption(value: AppTheme, title: string, subtitle: string, icon: "sun" | "moon") {
    const selected = theme === value;
    return (
      <button
        type="button"
        onClick={() => setTheme(value)}
        aria-pressed={selected}
        className={`flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-white text-ink hover:bg-surface-strong"}`}
      >
        <Icon name={icon} className="size-5 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`mt-0.5 block text-xs ${selected ? "text-accent-strong/80" : "text-ink-faint"}`}>{subtitle}</span>
        </span>
      </button>
    );
  }

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

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain p-5 sm:p-6">
          <section aria-labelledby="settings-language-title" className="space-y-3">
            <div>
              <h3 id="settings-language-title" className="text-sm font-bold text-ink">{t("Language / 언어")}</h3>
              <p className="mt-1 text-xs text-ink-muted">{t("Choose your preferred language.")}</p>
            </div>
            <div className="space-y-2">
              {languageOption("en", "🇬🇧 English", "English")}
              {languageOption("ko", "🇰🇷 한국어", t("Korean"))}
            </div>
          </section>

          <section aria-labelledby="settings-currency-title" className="space-y-3">
            <div>
              <h3 id="settings-currency-title" className="text-sm font-bold text-ink">{t("Currency / 통화")}</h3>
              <p className="mt-1 text-xs text-ink-muted">{t("Choose your preferred display currency.")}</p>
            </div>
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
          </section>

          <section aria-labelledby="settings-theme-title" className="space-y-3">
            <div>
              <h3 id="settings-theme-title" className="text-sm font-bold text-ink">{t("Appearance")}</h3>
              <p className="mt-1 text-xs text-ink-muted">{t("Choose how PointNull looks.")}</p>
            </div>
            <div className="flex gap-2">
              {themeOption("light", t("Light"), t("Bright workspace"), "sun")}
              {themeOption("dark", t("Dark"), t("Low-light workspace"), "moon")}
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-line bg-white px-5 py-4 text-xs text-ink-faint sm:px-6">
          {t("PointNull")} · {t("Settings")}
        </footer>
      </aside>
    </div>
  );
}
