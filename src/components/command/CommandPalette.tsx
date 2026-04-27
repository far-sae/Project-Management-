import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Search,
  LayoutDashboard,
  CheckSquare,
  Inbox,
  Calendar,
  BarChart3,
  Users,
  Settings as SettingsIcon,
  Plus,
  FolderKanban,
  Boxes,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  Keyboard,
  ArrowRight,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getWorkspaceDisplayName } from "@/lib/workspaceDisplay";
import { useProjects } from "@/hooks/useProjects";
import { useAllTasks } from "@/hooks/useAllTasks";
import {
  ALL_WORKSPACES_ID,
  useSelectedWorkspace,
} from "@/hooks/useSelectedWorkspace";
import { useTheme } from "@/context/ThemeContext";
import {
  COMMAND_OPEN_EVENT,
  openCommandPalette,
} from "@/components/layout/AppHeader";
import useGlobalShortcuts from "@/hooks/useGlobalShortcuts";

interface CommandPaletteProps {
  /** Optional callback called from command palette when "create task" is selected. */
  onCreateTask?: () => void;
}

const SHORTCUTS_OPEN_EVENT = "app:open-shortcuts";

export const openShortcutsModal = () => {
  try {
    window.dispatchEvent(new Event(SHORTCUTS_OPEN_EVENT));
  } catch {
    /* ignore */
  }
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  onCreateTask,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { projects } = useProjects();
  const { tasks } = useAllTasks();
  const { workspaces, select: selectWorkspace } = useSelectedWorkspace();
  const { mode, setMode, accent, setAccent } = useTheme();

  // Listen for global "open palette" events
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onShortcuts = () => setShortcutsOpen(true);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpen);
    window.addEventListener(SHORTCUTS_OPEN_EVENT, onShortcuts);
    return () => {
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpen);
      window.removeEventListener(SHORTCUTS_OPEN_EVENT, onShortcuts);
    };
  }, []);

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => setSearch(""), 150);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useGlobalShortcuts({
    onOpenPalette: () => setOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
    onCreateTask,
  });

  const handleRun = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 80);
  };

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks.slice(0, 6);
    return tasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [tasks, search]);

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-1/2 top-[14%] z-50 w-full max-w-2xl -translate-x-1/2 px-3",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
          >
            <DialogPrimitive.Title className="sr-only">
              Command palette
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search projects, tasks, and run commands.
            </DialogPrimitive.Description>
            <Command
              shouldFilter={true}
              className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 border-b border-border">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Type a command, task, or project…"
                  className="flex-1 h-12 bg-transparent text-foreground placeholder:text-muted-foreground outline-none border-0 text-sm"
                />
                <kbd className="hidden sm:inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground">
                  esc
                </kbd>
              </div>

              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
                  No results.
                </Command.Empty>

                {/* Quick actions */}
                <Command.Group heading="Quick actions" className={groupCls}>
                  {onCreateTask && (
                    <Command.Item
                      value="create new task"
                      onSelect={() => handleRun(onCreateTask)}
                      className={itemCls}
                    >
                      <Plus className="w-4 h-4 mr-2 text-muted-foreground" />
                      Create new task
                      <Shortcut keys={["c"]} />
                    </Command.Item>
                  )}
                  <Command.Item
                    value="new project"
                    onSelect={() =>
                      handleRun(() => navigate("/dashboard?newProject=1"))
                    }
                    className={itemCls}
                  >
                    <FolderKanban className="w-4 h-4 mr-2 text-muted-foreground" />
                    New project
                  </Command.Item>
                  <Command.Item
                    value="ai generate subtasks"
                    onSelect={() =>
                      handleRun(() => {
                        try {
                          window.dispatchEvent(
                            new Event("app:trigger-ai-subtasks"),
                          );
                        } catch {
                          /* ignore */
                        }
                      })
                    }
                    className={itemCls}
                  >
                    <Sparkles className="w-4 h-4 mr-2 text-muted-foreground" />
                    AI: Generate subtasks for current task
                  </Command.Item>
                  <Command.Item
                    value="show keyboard shortcuts"
                    onSelect={() => handleRun(() => setShortcutsOpen(true))}
                    className={itemCls}
                  >
                    <Keyboard className="w-4 h-4 mr-2 text-muted-foreground" />
                    Show keyboard shortcuts
                    <Shortcut keys={["?"]} />
                  </Command.Item>
                </Command.Group>

                {/* Navigation */}
                <Command.Group heading="Go to" className={groupCls}>
                  <NavItem
                    icon={LayoutDashboard}
                    label="Dashboard"
                    keys={["g", "d"]}
                    onSelect={() => handleRun(() => navigate("/dashboard"))}
                  />
                  <NavItem
                    icon={CheckSquare}
                    label="My tasks"
                    keys={["g", "t"]}
                    onSelect={() => handleRun(() => navigate("/tasks"))}
                  />
                  <NavItem
                    icon={Inbox}
                    label="Inbox"
                    keys={["g", "i"]}
                    onSelect={() => handleRun(() => navigate("/inbox"))}
                  />
                  <NavItem
                    icon={Calendar}
                    label="Calendar"
                    keys={["g", "c"]}
                    onSelect={() => handleRun(() => navigate("/calendar"))}
                  />
                  <NavItem
                    icon={BarChart3}
                    label="Reports"
                    keys={["g", "r"]}
                    onSelect={() => handleRun(() => navigate("/reports"))}
                  />
                  <NavItem
                    icon={Activity}
                    label="Workload"
                    keys={["g", "w"]}
                    onSelect={() => handleRun(() => navigate("/workload"))}
                  />
                  <NavItem
                    icon={Users}
                    label="Team"
                    keys={["g", "m"]}
                    onSelect={() => handleRun(() => navigate("/team"))}
                  />
                  <NavItem
                    icon={SettingsIcon}
                    label="Settings"
                    onSelect={() => handleRun(() => navigate("/settings"))}
                  />
                </Command.Group>

                {/* Workspaces */}
                {workspaces.length > 0 && (
                  <Command.Group heading="Switch workspace" className={groupCls}>
                    <Command.Item
                      value="switch all workspaces"
                      onSelect={() =>
                        handleRun(() => selectWorkspace(ALL_WORKSPACES_ID))
                      }
                      className={itemCls}
                    >
                      <Boxes className="w-4 h-4 mr-2 text-muted-foreground" />
                      All workspaces
                    </Command.Item>
                    {workspaces.slice(0, 8).map((w) => (
                      <Command.Item
                        key={w.workspaceId}
                        value={`workspace ${getWorkspaceDisplayName(w)}`}
                        onSelect={() =>
                          handleRun(() => selectWorkspace(w.workspaceId))
                        }
                        className={itemCls}
                      >
                        <Boxes className="w-4 h-4 mr-2 text-muted-foreground" />
                        {getWorkspaceDisplayName(w)}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Projects */}
                {projects.length > 0 && (
                  <Command.Group heading="Projects" className={groupCls}>
                    {projects.slice(0, 12).map((p) => (
                      <Command.Item
                        key={p.projectId}
                        value={`project ${p.name} ${p.description || ""}`}
                        onSelect={() =>
                          handleRun(() =>
                            navigate(`/project/${p.projectId}`),
                          )
                        }
                        className={itemCls}
                      >
                        <span
                          className="w-2 h-2 rounded-full mr-2 shrink-0"
                          style={{
                            background:
                              p.coverColor || "hsl(var(--primary))",
                          }}
                        />
                        <span className="truncate">{p.name}</span>
                        <ArrowRight className="ml-auto w-3.5 h-3.5 text-muted-foreground" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Tasks */}
                {filteredTasks.length > 0 && (
                  <Command.Group heading="Tasks" className={groupCls}>
                    {filteredTasks.map((t) => (
                      <Command.Item
                        key={t.taskId}
                        value={`task ${t.title} ${t.description || ""}`}
                        onSelect={() =>
                          handleRun(() =>
                            navigate(
                              `/project/${t.projectId}?taskId=${t.taskId}`,
                            ),
                          )
                        }
                        className={itemCls}
                      >
                        <CheckSquare className="w-4 h-4 mr-2 text-muted-foreground" />
                        <span className="truncate">{t.title}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t.status === "undefined" ? "todo" : t.status}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Theme */}
                <Command.Group heading="Theme" className={groupCls}>
                  <Command.Item
                    value="theme system"
                    onSelect={() => handleRun(() => setMode("system"))}
                    className={itemCls}
                  >
                    <Monitor className="w-4 h-4 mr-2 text-muted-foreground" />
                    Use system theme
                    {mode === "system" && (
                      <span className="ml-auto text-xs text-primary">active</span>
                    )}
                  </Command.Item>
                  <Command.Item
                    value="theme light"
                    onSelect={() => handleRun(() => setMode("light"))}
                    className={itemCls}
                  >
                    <Sun className="w-4 h-4 mr-2 text-muted-foreground" />
                    Light theme
                    {mode === "light" && (
                      <span className="ml-auto text-xs text-primary">active</span>
                    )}
                  </Command.Item>
                  <Command.Item
                    value="theme dark"
                    onSelect={() => handleRun(() => setMode("dark"))}
                    className={itemCls}
                  >
                    <Moon className="w-4 h-4 mr-2 text-muted-foreground" />
                    Dark theme
                    {mode === "dark" && (
                      <span className="ml-auto text-xs text-primary">active</span>
                    )}
                  </Command.Item>
                  {(["orange", "blue", "violet", "green", "pink", "slate"] as const).map(
                    (color) => (
                      <Command.Item
                        key={color}
                        value={`accent ${color}`}
                        onSelect={() => handleRun(() => setAccent(color))}
                        className={itemCls}
                      >
                        <span
                          className="w-3 h-3 rounded-full mr-2"
                          style={{
                            background: ({
                              orange: "hsl(24 95% 53%)",
                              blue: "hsl(217 91% 60%)",
                              violet: "hsl(262 83% 62%)",
                              green: "hsl(152 70% 42%)",
                              pink: "hsl(330 81% 60%)",
                              slate: "hsl(220 14% 35%)",
                            } as Record<string, string>)[color],
                          }}
                        />
                        Accent: {color}
                        {accent === color && (
                          <span className="ml-auto text-xs text-primary">active</span>
                        )}
                      </Command.Item>
                    ),
                  )}
                </Command.Group>
              </Command.List>

              <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-secondary/40 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Hint label="↑↓ navigate" />
                  <Hint label="↵ open" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setTimeout(() => setShortcutsOpen(true), 100);
                  }}
                  className="hover:text-foreground"
                >
                  More shortcuts (?)
                </button>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
};

const groupCls =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

const itemCls =
  "flex items-center gap-1 px-2 py-2 rounded-md text-sm cursor-pointer aria-selected:bg-secondary aria-selected:text-foreground text-foreground/90 hover:bg-secondary";

const Shortcut: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="ml-auto flex items-center gap-1">
    {keys.map((k, i) => (
      <kbd
        key={i}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground"
      >
        {k}
      </kbd>
    ))}
  </span>
);

const Hint: React.FC<{ label: string }> = ({ label }) => (
  <span>{label}</span>
);

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  keys?: string[];
  onSelect: () => void;
}

const NavItem: React.FC<NavItemProps> = ({
  icon: Icon,
  label,
  keys,
  onSelect,
}) => (
  <Command.Item
    value={`go to ${label}`}
    onSelect={onSelect}
    className={itemCls}
  >
    <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
    {label}
    {keys && <Shortcut keys={keys} />}
  </Command.Item>
);

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  open,
  onOpenChange,
}) => {
  const groups = [
    {
      title: "General",
      items: [
        { keys: ["⌘", "K"], altKeys: ["Ctrl", "K"], label: "Open command palette" },
        { keys: ["/"], label: "Open command palette / search" },
        { keys: ["?"], label: "Show this cheat sheet" },
        { keys: ["c"], label: "Create new task (when in a project)" },
      ],
    },
    {
      title: "Navigation",
      items: [
        { keys: ["g", "d"], label: "Go to Dashboard" },
        { keys: ["g", "t"], label: "Go to My Tasks" },
        { keys: ["g", "i"], label: "Go to Inbox" },
        { keys: ["g", "c"], label: "Go to Calendar" },
        { keys: ["g", "r"], label: "Go to Reports" },
        { keys: ["g", "w"], label: "Go to Workload" },
        { keys: ["g", "m"], label: "Go to Team" },
      ],
    },
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl">
          <DialogPrimitive.Title className="text-lg font-semibold text-foreground mb-1">
            Keyboard shortcuts
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground mb-4">
            Quick keys to move around without leaving your keyboard.
          </DialogPrimitive.Description>

          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {g.title}
                </p>
                <ul className="space-y-1.5">
                  {g.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-foreground/90">{item.label}</span>
                      <span className="flex items-center gap-1">
                        {item.keys.map((k, j) => (
                          <kbd
                            key={j}
                            className="text-[11px] font-medium px-1.5 py-0.5 rounded border border-border bg-background text-foreground"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-6 w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Got it
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

// Public re-exports for components that want to programmatically open
export { openCommandPalette };
