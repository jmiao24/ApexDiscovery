// Minimal login gate for the self-hosted web server: exchange the server's
// token (printed at server startup / APEX_TOKEN) for the HttpOnly session
// cookie, then reload into the full app.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { webLogin } from "@/lib/tauri";

export function WebLogin() {
  const { t } = useTranslation("common");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await webLogin(token.trim())) {
        window.location.reload();
        return;
      }
      setError(t("login.wrongToken"));
    } catch {
      setError(t("login.unreachable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-text">
      <form onSubmit={submit} className="w-80 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-base font-semibold">{t("login.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("login.hint")}</p>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("login.placeholder")}
          className="mt-4 w-full rounded-input border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-[12px] text-error">{error}</p>}
        <button
          type="submit"
          disabled={!token.trim() || busy}
          className="mt-4 w-full rounded-input bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {busy ? t("login.signingIn") : t("login.signIn")}
        </button>
      </form>
    </div>
  );
}
