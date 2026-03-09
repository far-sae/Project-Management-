/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string
  /** Comma-separated Supabase user IDs for app/product owners (builders); they get full access everywhere. */
  readonly VITE_APP_OWNER_USER_IDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
