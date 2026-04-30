// Smoke test: verifies build + key files are present.
//
// Note: this used to also probe `.env` for VITE_OPENAI_API_KEY / VITE_FIREBASE_API_KEY.
// Those checks were removed because Vite inlines every `VITE_*` variable into the
// client bundle, so any *secret* (OpenAI, Firebase service account, etc.) prefixed
// with VITE_ would be exfiltrable from the browser. The OpenAI key now lives only on
// the Supabase Edge Function (`supabase/functions/ai-chat`) and must NOT be set as a
// VITE_ variable on the frontend.
import fs from 'fs';
import path from 'path';

console.log('Testing application functionality...\n');

const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (fs.existsSync(indexPath)) {
  console.log('OK Build exists');
} else {
  console.log('MISSING Build (run `bun run build`)');
}

const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.log('MISSING .env file. Copy .env.example to .env and fill in Supabase credentials.');
} else {
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (!envContent.includes('VITE_SUPABASE_URL') || !envContent.includes('VITE_SUPABASE_ANON_KEY')) {
    console.log('WARN .env missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  } else {
    console.log('OK Supabase env present');
  }
  if (/VITE_OPENAI_API_KEY|VITE_FIREBASE_API_KEY|VITE_STRIPE_SECRET/.test(envContent)) {
    console.log(
      'SECURITY any VITE_* secret is bundled into the browser. Move OpenAI / Stripe / service-account keys to Supabase Edge Function secrets instead.'
    );
  }
}

const checks = [
  ['src/services/supabase/organizations.ts', 'Organizations service'],
  ['src/context/OrganizationContext.tsx', 'Organization context'],
  ['src/types/project.ts', 'Project types'],
  ['src/services/ai/taskSuggestions.ts', 'AI task suggestions'],
  ['src/services/ai/rateLimiter.ts', 'AI rate limiter'],
  ['src/services/supabase/invitations.ts', 'Invitations service'],
  ['src/hooks/useComments.ts', 'Comments hook'],
];

for (const [rel, label] of checks) {
  const exists = fs.existsSync(path.join(process.cwd(), rel));
  console.log(`${exists ? 'OK' : 'MISSING'} ${label} (${rel})`);
}

console.log('\nSmoke test complete.');
