// The selected-workspace state moved into WorkspaceContext so it is owned in
// one place. This module stays as the import path every existing caller uses.
export {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
} from "@/lib/workspaceScope";
export {
  useWorkspaceScope as useSelectedWorkspace,
  useWorkspaceScope as default,
} from "@/context/WorkspaceContext";
