import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { mockProject } from "@/lib/mock";
import { useRuntimeStore } from "@/lib/runtime";

export function AppShell() {
  // In the packaged desktop app, auto-start the bundled OpenCode and connect.
  useEffect(() => {
    void useRuntimeStore.getState().bootstrap();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text">
      <Sidebar project={mockProject} />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}
