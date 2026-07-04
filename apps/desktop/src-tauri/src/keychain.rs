// Keep provider credentials (OpenCode's auth.json) at rest in the OS keychain
// instead of a plaintext file (P2-3). OpenCode still reads auth.json at runtime,
// so we hydrate it from the keychain before the sidecar starts and persist it
// back — deleting the plaintext file — on a clean app exit.
//
// Invariant: credentials are NEVER lost. auth.json is present whenever the
// sidecar runs, and is deleted only after it has been successfully written to
// the keychain. Any keychain failure leaves the file in place (same exposure as
// before this feature — no regression).
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.ai4s.workbench";
const ACCOUNT: &str = "opencode-auth";

/// A place to keep one secret at rest. Abstracted so the file<->store dance can
/// be unit-tested without touching the real OS keychain.
trait SecretStore {
    fn load(&self) -> Option<String>;
    /// Returns true only if the secret is now durably stored.
    fn save(&self, secret: &str) -> bool;
}

struct Keyring;

impl SecretStore for Keyring {
    fn load(&self) -> Option<String> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
        match entry.get_password() {
            Ok(s) if !s.is_empty() => Some(s),
            _ => None,
        }
    }
    fn save(&self, secret: &str) -> bool {
        keyring::Entry::new(SERVICE, ACCOUNT)
            .and_then(|e| e.set_password(secret))
            .is_ok()
    }
}

fn auth_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("xdg-data")
        .join("opencode")
        .join("auth.json"))
}

#[cfg(unix)]
fn lock_down(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn lock_down(_path: &Path) {}

/// Restore auth.json from the keychain before the sidecar starts, if the file is
/// absent. When the file already exists it is the source of truth (a mid-session
/// OAuth write, or a force-quit that skipped persist) and is left untouched.
fn hydrate_with(path: &Path, store: &dyn SecretStore) {
    if path.exists() {
        return;
    }
    let Some(secret) = store.load() else { return };
    if let Some(dir) = path.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    if std::fs::write(path, &secret).is_ok() {
        lock_down(path);
    }
}

/// Persist auth.json into the keychain and remove the plaintext file. Keeps the
/// file if there is nothing to store or the keychain write fails.
fn persist_with(path: &Path, store: &dyn SecretStore) {
    let Ok(secret) = std::fs::read_to_string(path) else { return };
    if secret.trim().is_empty() {
        return;
    }
    if store.save(&secret) {
        let _ = std::fs::remove_file(path);
    }
}

pub fn hydrate(app: &AppHandle) {
    if let Ok(path) = auth_path(app) {
        hydrate_with(&path, &Keyring);
    }
}

pub fn persist(app: &AppHandle) {
    if let Ok(path) = auth_path(app) {
        persist_with(&path, &Keyring);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct MemStore {
        slot: RefCell<Option<String>>,
        fail_save: bool,
    }
    impl SecretStore for MemStore {
        fn load(&self) -> Option<String> {
            self.slot.borrow().clone()
        }
        fn save(&self, secret: &str) -> bool {
            if self.fail_save {
                return false;
            }
            *self.slot.borrow_mut() = Some(secret.to_string());
            true
        }
    }

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("ai4s-kc-{tag}-{}", std::process::id())).join("auth.json");
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
        p
    }

    #[test]
    fn persist_saves_then_removes_and_hydrate_restores() {
        let path = tmp("roundtrip");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{\"k\":\"secret\"}").unwrap();
        let store = MemStore { slot: RefCell::new(None), fail_save: false };

        persist_with(&path, &store);
        assert!(!path.exists(), "plaintext file removed after keychain save");
        assert_eq!(store.slot.borrow().as_deref(), Some("{\"k\":\"secret\"}"));

        // A later run with no file on disk restores it from the store.
        hydrate_with(&path, &store);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"k\":\"secret\"}");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn keychain_failure_keeps_the_file() {
        let path = tmp("failsafe");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "creds").unwrap();
        let store = MemStore { slot: RefCell::new(None), fail_save: true };

        persist_with(&path, &store);
        assert!(path.exists(), "file must remain when the keychain write fails");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "creds");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn hydrate_never_clobbers_an_existing_file() {
        let path = tmp("noclobber");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "on-disk-wins").unwrap();
        let store = MemStore { slot: RefCell::new(Some("from-keychain".into())), fail_save: false };

        hydrate_with(&path, &store);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "on-disk-wins");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    #[ignore] // hits the real OS keychain; run explicitly with --ignored
    fn real_keychain_roundtrip() {
        // A throwaway account so the test never touches the real credential slot.
        let entry = keyring::Entry::new(SERVICE, "roundtrip-test").unwrap();
        assert!(entry.set_password("hello-test").is_ok(), "keychain save failed");
        assert_eq!(entry.get_password().ok().as_deref(), Some("hello-test"));
        let _ = entry.delete_credential();
    }

    #[test]
    fn persist_skips_empty_or_missing() {
        let path = tmp("empty");
        let store = MemStore { slot: RefCell::new(None), fail_save: false };
        persist_with(&path, &store); // missing file → no-op
        assert!(store.slot.borrow().is_none());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "   \n").unwrap();
        persist_with(&path, &store); // whitespace-only → no-op, file kept
        assert!(store.slot.borrow().is_none());
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
