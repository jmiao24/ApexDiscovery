// Shared shell-command core: the OS-capability layer both frontends sit on.
// The Tauri desktop app and the self-hosted web server call the same functions;
// each host supplies a `ShellCtx` (paths + app version) and does its own process
// spawning/UI. Nothing in this crate depends on Tauri or on any HTTP framework.
pub mod artifact;
pub mod assets;
pub mod ctx;
pub mod debug_log;
pub mod git_snapshot;
pub mod large_file;
pub mod preview;
pub mod provenance;
pub mod runs;
pub mod runs_index;
pub mod runtime;
pub mod runtime_config;
pub mod util;

pub use ctx::ShellCtx;
