import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readMediapipeTasksVisionVersion(): string {
  const fromNodeModules = join(
    __dirname,
    'node_modules',
    '@mediapipe',
    'tasks-vision',
    'package.json',
  );
  try {
    const mp = JSON.parse(readFileSync(fromNodeModules, 'utf-8')) as {
      version?: string;
    };
    if (mp.version && /^\d+\.\d+\.\d+/.test(mp.version)) return mp.version;
  } catch {
    /* install may not exist yet in some CI contexts */
  }
  const pkg = JSON.parse(
    readFileSync(join(__dirname, 'package.json'), 'utf-8'),
  ) as { dependencies?: Record<string, string> };
  return (pkg.dependencies?.['@mediapipe/tasks-vision'] ?? '0.10.35').replace(
    /^[\^~]/,
    '',
  );
}

const mediapipeTasksVisionVersion = readMediapipeTasksVisionVersion()

export default defineConfig({
  define: {
    // Keep WASM URL in BackgroundProcessor.ts aligned with package.json at build time.
    __MEDIAPIPE_TASKS_VISION_VERSION__: JSON.stringify(mediapipeTasksVisionVersion),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react';
          if (id.includes('node_modules/react-router')) return 'router';
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/@radix-ui')) return 'radix';
          if (id.includes('node_modules/@stripe')) return 'stripe';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/@dnd-kit')) return 'dnd';
          if (id.includes('node_modules/date-fns')) return 'date-fns';
          if (id.includes('node_modules/lucide-react')) return 'lucide';
        },
      },
    },
  },
})
