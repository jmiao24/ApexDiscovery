import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// APEX Discovery intentionally ships an English-only interface. The resource
// catalog remains centralized so UI copy is typed and consistent, but there is
// no locale detection, language switcher, or runtime language state.
import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enRuns from "./locales/en/runs.json";
import enSession from "./locales/en/session.json";
import enInspector from "./locales/en/inspector.json";
import enErrors from "./locales/en/errors.json";
import enPages from "./locales/en/pages.json";

export const NAMESPACES = [
  "common", "nav", "settings", "runs", "session", "inspector", "errors", "pages",
] as const;

const resources = {
  en: { common: enCommon, nav: enNav, settings: enSettings, runs: enRuns, session: enSession, inspector: enInspector, errors: enErrors, pages: enPages },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en"],
  defaultNS: "common",
  ns: NAMESPACES,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
});

export default i18n;
