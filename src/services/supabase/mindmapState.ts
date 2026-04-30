import { supabase } from './config';

/**
 * Mind-map extras shape — mirrors the interface in ProjectMindMap.tsx.
 * Stored as JSONB in `mind_map_state.state`.
 */
export interface MindMapExtras {
  ideas: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    color?: string;
    /** Visual style for this placeholder — task / column / project header,
     *  or undefined for a pill-shaped brainstorm idea. Cosmetic only. */
    kind?: 'task' | 'column' | 'project';
    /** Notes / description shown when the user opens the placeholder. */
    description?: string;
    /** Subtasks list — mind-map-only, never reaches kanban. */
    subtasks?: Array<{ id: string; title: string; completed: boolean }>;
    /** Files uploaded for this placeholder. Stored in `project-files` bucket. */
    attachments?: Array<{
      fileId: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
      storagePath: string;
      uploadedAt?: string;
    }>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  positions: Record<string, { x: number; y: number }>;
  /** Auto-derived structural edge ids the user has hidden from the canvas. */
  removedAutoEdges: string[];
}

const EMPTY_EXTRAS: MindMapExtras = {
  ideas: [],
  edges: [],
  positions: {},
  removedAutoEdges: [],
};

// ── Read ─────────────────────────────────────────────────────

export async function loadMindMapState(
  projectId: string,
  userId: string,
): Promise<MindMapExtras> {
  try {
    const { data, error } = await supabase
      .from('mind_map_state')
      .select('state')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.state) return EMPTY_EXTRAS;

    const parsed = data.state as Partial<MindMapExtras>;
    return {
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      positions:
        parsed.positions && typeof parsed.positions === 'object'
          ? parsed.positions
          : {},
      removedAutoEdges: Array.isArray(parsed.removedAutoEdges)
        ? parsed.removedAutoEdges.filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    };
  } catch {
    // Table may not exist yet — fall back to empty
    return EMPTY_EXTRAS;
  }
}

// ── Write ────────────────────────────────────────────────────

export async function saveMindMapState(
  projectId: string,
  userId: string,
  extras: MindMapExtras,
): Promise<void> {
  try {
    await supabase.from('mind_map_state').upsert(
      {
        project_id: projectId,
        user_id: userId,
        state: extras as unknown as Record<string, unknown>,
        version: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,user_id' },
    );
  } catch {
    // Silently fail — mind map still works via localStorage fallback
  }
}

// ── Migration helper ─────────────────────────────────────────
// Moves existing localStorage extras to Supabase (one-shot per project).

const MIGRATED_KEY = (projectId: string) =>
  `mindmap_cloud_migrated:${projectId}`;

export async function migrateLocalStorageToCloud(
  projectId: string,
  userId: string,
): Promise<MindMapExtras> {
  // Already migrated?
  if (typeof window === 'undefined') return EMPTY_EXTRAS;
  const migrated = window.localStorage.getItem(MIGRATED_KEY(projectId));
  if (migrated === '1') {
    return loadMindMapState(projectId, userId);
  }

  // Try to load from localStorage (legacy key)
  const legacyKey = `mindmap_extras_v1:${projectId}`;
  const raw = window.localStorage.getItem(legacyKey);

  // Load cloud version first
  const cloudState = await loadMindMapState(projectId, userId);

  if (raw) {
    try {
      const local = JSON.parse(raw) as Partial<MindMapExtras>;
      const localExtras: MindMapExtras = {
        ideas: Array.isArray(local.ideas) ? local.ideas : [],
        edges: Array.isArray(local.edges) ? local.edges : [],
        positions:
          local.positions && typeof local.positions === 'object'
            ? local.positions
            : {},
        removedAutoEdges: Array.isArray(local.removedAutoEdges)
          ? local.removedAutoEdges.filter(
              (v): v is string => typeof v === 'string',
            )
          : [],
      };

      // If cloud is empty but local has data, push local → cloud
      const cloudEmpty =
        cloudState.ideas.length === 0 &&
        cloudState.edges.length === 0 &&
        Object.keys(cloudState.positions).length === 0 &&
        cloudState.removedAutoEdges.length === 0;

      const localHasData =
        localExtras.ideas.length > 0 ||
        localExtras.edges.length > 0 ||
        Object.keys(localExtras.positions).length > 0 ||
        localExtras.removedAutoEdges.length > 0;

      if (cloudEmpty && localHasData) {
        await saveMindMapState(projectId, userId, localExtras);
        window.localStorage.setItem(MIGRATED_KEY(projectId), '1');
        return localExtras;
      }
    } catch {
      // Corrupt localStorage — ignore
    }
  }

  window.localStorage.setItem(MIGRATED_KEY(projectId), '1');
  return cloudState;
}
