// Build-time feature flags. Default OFF — enable by setting the env var and
// rebuilding, e.g. VITE_ENABLE_WHATSAPP=true.
export const FEATURES = {
  whatsapp: import.meta.env.VITE_ENABLE_WHATSAPP === "true",
  gmail: import.meta.env.VITE_ENABLE_GMAIL === "true",
} as const;
