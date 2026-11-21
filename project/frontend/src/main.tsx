import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { PreferencesProvider } from "./preferences";

// Apply a saved dark theme before React paints to avoid a light-mode flash.
try {
  if (window.localStorage.getItem("pointnull-theme") === "dark") {
    document.documentElement.classList.add("theme-dark");
  }
  const savedDisplaySize = window.localStorage.getItem("pointnull-display-size");
  if (savedDisplaySize === "compact" || savedDisplaySize === "large" || savedDisplaySize === "default") {
    document.documentElement.dataset.displaySize = savedDisplaySize;
  }
} catch {
  // Preferences still work for this session if browser storage is unavailable.
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </React.StrictMode>,
);
