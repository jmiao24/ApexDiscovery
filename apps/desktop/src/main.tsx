import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import { LocaleProvider } from "./app/providers/LocaleProvider";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import { WebLogin } from "./app/WebLogin";
import { initShell } from "./lib/tauri";
import "./index.css";

// Detect the hosting shell (Tauri desktop / self-hosted web server / plain
// browser dev) BEFORE rendering, so every render-time hasShell() read is
// stable. The web server requires a one-time token login first.
void initShell().then(({ shell, authenticated }) => {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  if (shell === "web" && !authenticated) {
    root.render(
      <React.StrictMode>
        <ThemeProvider>
          <WebLogin />
        </ThemeProvider>
      </React.StrictMode>,
    );
    return;
  }
  // The router import is deferred behind the shell probe on purpose: modules
  // it pulls in read hasShell() in store initializers at import time.
  void import("./app/router").then(({ router }) => {
    root.render(
      <React.StrictMode>
        <LocaleProvider>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </LocaleProvider>
      </React.StrictMode>,
    );
  });
});
