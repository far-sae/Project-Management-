// The autopilot's settings, in groups: the switch, the business, what it posts,
// how it writes, pictures and videos, when it posts, how it learns, and money
// and accounts. Nothing is saved until Save is pressed.
import React, { useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SetupHint } from '@/components/common/SetupHint';
import {
  AUTOPILOT_MODES, CAPTION_NAME, CUSTOM_LIMITS, EMOJI_NAME, GOAL_NAME, MIX_NAME, MODE_HINT, MODE_NAME, SETTING_LIMITS, TRENDS_EVERY, TRENDS_EVERY_NAME, VOICE_NAME,
  WEEKDAY_NAME, WEEK_ORDER, readTags, readTimes, siteOf,
  type AutopilotCustom, type AutopilotSettings, type CaptionLength, type EmojiUse, type MediaFormat, type MediaMix, type PostGoal, type TrendsEvery, type VoiceChoice,
} from '../../../api/_social/shared/autopilot';
import { PLATFORM_NAME, TIKTOK_PRIVACY_LABEL, isPlatform, type TikTokPrivacy } from '../../../api/_social/shared/platforms';
import type { SocialAccount } from '@/types/social';

interface Props {
  form: AutopilotSettings;
  onChange: (next: AutopilotSettings) => void;
  /** The connected accounts it can post to. */
  postable: SocialAccount[];
  problems: string[];
  changed: boolean;
  saving: boolean;
  onSave: () => void;
  /** The website is being read for the form. */
  reading: boolean;
  onReadWebsite: () => void;
  /** The website address was changed: what was read from the old one no longer counts. */
  onWebsiteTyped: () => void;
  /** A line under the money box: what a month can cost with these settings. */
  costNote: string;
  /** False when the database cannot keep the newer options yet. */
  customReady: boolean;
}

const SELECT = 'h-11 md:h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const HINT = 'mt-1 text-xs text-muted-foreground';
const WIDE = 'sm:col-span-2';

const Group: React.FC<{ title: string; hint: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="grid gap-x-8 gap-y-3 border-t border-border px-4 py-5 first:border-t-0 lg:grid-cols-[15rem_minmax(0,1fr)]">
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
    <div className="grid content-start gap-4 sm:grid-cols-2">{children}</div>
  </div>
);

function Choice<T extends string | number>({ id, label, value, names, onChange, disabled, hint }: {
  id: string; label: string; value: T; names: Record<T, string>; onChange: (next: T) => void; disabled?: boolean; hint?: string;
}) {
  const keys = Object.keys(names) as string[];
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id} className={SELECT} value={String(value)} disabled={disabled}
        onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
      >
        {keys.map((k) => <option key={k} value={k}>{names[k as unknown as T]}</option>)}
      </select>
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

export const AutopilotSettingsForm: React.FC<Props> = ({ form, onChange, postable, problems, changed, saving, onSave, reading, onReadWebsite, onWebsiteTyped, costNote, customReady }) => {
  /** The posting times and the tags as they are being typed. */
  const [timesText, setTimesText] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState<string | null>(null);

  const set = <K extends keyof AutopilotSettings>(key: K, value: AutopilotSettings[K]) => onChange({ ...form, [key]: value });
  const setCustom = <K extends keyof AutopilotCustom>(key: K, value: AutopilotCustom[K]) => onChange({ ...form, custom: { ...form.custom, [key]: value } });
  const c = form.custom;
  const hasTikTok = postable.some((a) => a.provider === 'tiktok');
  const both = form.formats.length > 1;
  const trendNames = Object.fromEntries(TRENDS_EVERY.map((d) => [d, TRENDS_EVERY_NAME[d]])) as Record<TrendsEvery, string>;

  return (
    <div>
      <Group title="The switch" hint="Start on “Ask me first”. You see every post before it goes out.">
        <div className={WIDE}>
          <Label className="block">The switch</Label>
          <div role="radiogroup" aria-label="The switch" className="mt-1 inline-flex flex-wrap rounded-md border border-border p-0.5">
            {AUTOPILOT_MODES.map((m) => (
              <Button key={m} type="button" size="sm" role="radio" aria-checked={form.mode === m} variant={form.mode === m ? 'secondary' : 'ghost'} onClick={() => set('mode', m)}>{MODE_NAME[m]}</Button>
            ))}
          </div>
          <p className={HINT}>{MODE_HINT[form.mode]}</p>
        </div>
      </Group>

      <Group title="Your business" hint="The autopilot writes only from this. It does not invent prices or offers.">
        <div className={WIDE}>
          <Label htmlFor="ap-website">Your website</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Input id="ap-website" className="min-w-0 flex-1" maxLength={SETTING_LIMITS.website} value={form.website} onChange={(e) => { set('website', e.target.value); onWebsiteTyped(); }} placeholder="yourbusiness.com" />
            <Button type="button" variant="outline" disabled={reading || !siteOf(form.website)} onClick={onReadWebsite}>
              {reading ? <Loader2 className="animate-spin" aria-hidden /> : <Globe aria-hidden />}{reading ? 'Reading your website…' : 'Fill in from my website'}
            </Button>
          </div>
          <p className={HINT}>
            The autopilot reads your website to learn what you sell, your prices and your offers, and writes the boxes below for you. It reads it again every month. Reading takes a minute or two.
          </p>
        </div>
        <div className={WIDE}>
          <Label htmlFor="ap-brief">Your business</Label>
          <Textarea id="ap-brief" rows={3} maxLength={SETTING_LIMITS.brief} value={form.brief} onChange={(e) => set('brief', e.target.value)} placeholder="Harbour Dental is a family dentist in Leeds. We offer check-ups, whitening and braces." />
          <p className={HINT}>What you do and sell. The autopilot writes only from this: it does not invent prices or offers.</p>
        </div>
        <div>
          <Label htmlFor="ap-audience">Who you want to reach</Label>
          <Input id="ap-audience" maxLength={SETTING_LIMITS.audience} value={form.audience} onChange={(e) => set('audience', e.target.value)} placeholder="Families in Leeds" />
        </div>
        <div>
          <Label htmlFor="ap-tone">How it should sound</Label>
          <Input id="ap-tone" maxLength={SETTING_LIMITS.tone} value={form.tone} onChange={(e) => set('tone', e.target.value)} placeholder="Friendly and calm" />
        </div>
        <div>
          <Label htmlFor="ap-language">Language of the posts</Label>
          <Input id="ap-language" maxLength={SETTING_LIMITS.language} value={form.language} onChange={(e) => set('language', e.target.value)} />
        </div>
      </Group>

      <Group title="What it posts" hint="All of this is optional. Leave a box empty and the autopilot chooses from your numbers.">
        {!customReady && (
          <p role="status" className={`${WIDE} rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground`}>
            The options in “What it posts”, “How it writes” and the look of pictures and videos cannot be kept yet.{' '}
            <SetupHint other="Please ask the person who set up the site to finish the latest update.">Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.</SetupHint>
          </p>
        )}
        <Choice<PostGoal> id="ap-goal" label="What the posts are for" value={c.goal} names={GOAL_NAME} onChange={(v) => setCustom('goal', v)} />
        <div>
          <Label htmlFor="ap-cta">What people should do after a post</Label>
          <Input id="ap-cta" maxLength={CUSTOM_LIMITS.callToAction} value={c.callToAction} onChange={(e) => setCustom('callToAction', e.target.value)} placeholder="Book a free check-up" />
        </div>
        <div className={WIDE}>
          <Label htmlFor="ap-topics">Topics to post about</Label>
          <Textarea id="ap-topics" rows={2} maxLength={CUSTOM_LIMITS.topics} value={c.topics} onChange={(e) => setCustom('topics', e.target.value)} placeholder="Whitening, braces for adults, tips for children’s teeth" />
        </div>
        <div className={WIDE}>
          <Label htmlFor="ap-avoid">Never post about, never say</Label>
          <Textarea id="ap-avoid" rows={2} maxLength={CUSTOM_LIMITS.avoid} value={c.avoid} onChange={(e) => setCustom('avoid', e.target.value)} placeholder="Other dentists, the word “cheap”, politics" />
        </div>
        <div className={WIDE}>
          <Label htmlFor="ap-link">Link for the posts</Label>
          <Input id="ap-link" maxLength={CUSTOM_LIMITS.link} value={c.link} onChange={(e) => setCustom('link', e.target.value)} placeholder="yourbusiness.com/book" />
          <p className={HINT}>It is written at the end of a post. Instagram and TikTok show a link as plain text that cannot be pressed.</p>
        </div>
        <div className={WIDE}>
          <Label htmlFor="ap-rules">Your own rules</Label>
          <Textarea id="ap-rules" rows={3} maxLength={CUSTOM_LIMITS.rules} value={c.rules} onChange={(e) => setCustom('rules', e.target.value)} placeholder="Always name the city. Never promise a result. Write “we”, not “I”." />
          <p className={HINT}>Anything else it must keep to in every post, in your own words.</p>
        </div>
      </Group>

      <Group title="How it writes" hint="The length of the text, emoji and the tags under every post.">
        <Choice<CaptionLength> id="ap-length" label="Length of the text" value={c.captionLength} names={CAPTION_NAME} onChange={(v) => setCustom('captionLength', v)} />
        <Choice<EmojiUse> id="ap-emoji" label="Emoji" value={c.emoji} names={EMOJI_NAME} onChange={(v) => setCustom('emoji', v)} />
        <div className={WIDE}>
          <Label htmlFor="ap-tags">Tags on every post</Label>
          <Input
            id="ap-tags" value={tagsText ?? c.fixedTags.map((t) => `#${t}`).join(' ')} placeholder="#yourbusiness #yourcity"
            onChange={(e) => { setTagsText(e.target.value); setCustom('fixedTags', readTags(e.target.value)); }}
          />
          <p className={HINT}>
            {c.fixedTags.length > 0 ? `On every post: ${c.fixedTags.map((t) => `#${t}`).join(' ')}. It adds its own tags after these.` : `Up to ${CUSTOM_LIMITS.fixedTags} tags. It adds its own tags after these.`}
          </p>
        </div>
      </Group>

      <Group title="Pictures and videos" hint="What it makes, and how it should look.">
        <fieldset>
          <legend className="text-sm font-medium">What it makes</legend>
          <div className="mt-2 flex gap-4 text-sm">
            {(['image', 'video'] as MediaFormat[]).map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.formats.includes(f)} onChange={(e) => set('formats', e.target.checked ? [...new Set([...form.formats, f])] : form.formats.filter((x) => x !== f))} />
                {f === 'image' ? 'Pictures' : 'Videos (reels)'}
              </label>
            ))}
          </div>
        </fieldset>
        <Choice<MediaMix> id="ap-mix" label="Pictures or videos more often" value={c.mix} names={MIX_NAME} onChange={(v) => setCustom('mix', v)} disabled={!both} hint={both ? undefined : 'Tick both kinds to choose this.'} />
        <Choice<VoiceChoice> id="ap-voice" label="Voice in videos" value={form.voice} names={VOICE_NAME} onChange={(v) => set('voice', v)} disabled={!form.formats.includes('video')} />
        <div className={WIDE}>
          <Label htmlFor="ap-look">How pictures and videos should look</Label>
          <Textarea id="ap-look" rows={2} maxLength={CUSTOM_LIMITS.look} value={c.look} onChange={(e) => setCustom('look', e.target.value)} placeholder="Bright and clean, light blue and white, real-looking photos, never cartoons" />
          <p className={HINT}>Your colours, the style, and anything it should never show.</p>
        </div>
      </Group>

      <Group title="When it posts" hint="How often, on which days and at which times.">
        <div>
          <Label htmlFor="ap-posts">Posts each week</Label>
          <Input id="ap-posts" type="number" min={SETTING_LIMITS.postsMin} max={SETTING_LIMITS.postsMax} value={form.postsPerWeek} onChange={(e) => set('postsPerWeek', Math.min(SETTING_LIMITS.postsMax, Math.max(SETTING_LIMITS.postsMin, Number(e.target.value) || SETTING_LIMITS.postsMin)))} />
        </div>
        <div>
          <Label htmlFor="ap-zone">Time zone of the posting times</Label>
          <Input id="ap-zone" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Europe/London" />
        </div>
        <fieldset className={WIDE}>
          <legend className="text-sm font-medium">Days it may post on</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {WEEK_ORDER.map((d) => {
              const any = form.postDays.length === 0;
              return (
                <label key={d} className="flex items-center gap-2">
                  <input
                    type="checkbox" className="h-4 w-4 accent-primary" checked={any || form.postDays.includes(d)}
                    onChange={(e) => {
                      const now = new Set<number>(any ? WEEK_ORDER : form.postDays);
                      if (e.target.checked) now.add(d); else now.delete(d);
                      // Every day ticked, or none, is "any day".
                      set('postDays', now.size === 7 || now.size === 0 ? [] : [...now].sort((a, b) => a - b));
                    }}
                  />
                  {WEEKDAY_NAME[d]}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className={WIDE}>
          <Label htmlFor="ap-times">Times it may post at</Label>
          <Input
            id="ap-times" value={timesText ?? form.postTimes.join(', ')} placeholder="Leave empty and it chooses the best times from your numbers"
            onChange={(e) => { setTimesText(e.target.value); set('postTimes', readTimes(e.target.value)); }}
          />
          <p className={HINT}>
            {form.postTimes.length > 0 ? `It posts only at: ${form.postTimes.join(', ')}.` : 'For example: 09:00, 18:30. Up to six times, with commas between them.'}
          </p>
        </div>
      </Group>

      <Group title="How it learns" hint="It watches the numbers of every post and changes what it does.">
        <Choice<TrendsEvery> id="ap-trends" label="Look up the latest trends" value={c.trendsEveryDays} names={trendNames} onChange={(v) => setCustom('trendsEveryDays', v)} hint="Each look-up costs a few cents of the monthly limit." />
        <label className={`flex items-start gap-2 text-sm ${WIDE}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={form.retryWeak} onChange={(e) => set('retryWeak', e.target.checked)} />
          <span>When one of its posts does weakly, post a better version once. <span className="text-muted-foreground">A post cannot be changed after it is out, so the better version is a new post.</span></span>
        </label>
      </Group>

      <Group title="Money and accounts" hint="The most it may spend, and where it posts.">
        <div className={WIDE}>
          <Label htmlFor="ap-budget">Most it may spend in a month (US dollars)</Label>
          <Input id="ap-budget" className="sm:max-w-xs" type="number" min={0} max={SETTING_LIMITS.budgetMax / 100} value={Math.round(form.budgetCents / 100)} onChange={(e) => set('budgetCents', Math.min(SETTING_LIMITS.budgetMax, Math.max(0, Math.round(Number(e.target.value) || 0) * 100)))} />
          <p className={HINT}>{costNote}</p>
        </div>
        {hasTikTok && (
          <div className={WIDE}>
            <Label htmlFor="ap-tiktok">Who can see its TikTok videos</Label>
            <select id="ap-tiktok" className={`${SELECT} sm:max-w-md`} value={form.tiktokPrivacy} onChange={(e) => set('tiktokPrivacy', e.target.value as TikTokPrivacy | '')}>
              <option value="">Choose (until then it does not post to TikTok)</option>
              {(Object.keys(TIKTOK_PRIVACY_LABEL) as TikTokPrivacy[]).map((p) => <option key={p} value={p}>{TIKTOK_PRIVACY_LABEL[p]}</option>)}
            </select>
          </div>
        )}
        <fieldset className={WIDE}>
          <legend className="text-sm font-medium">Accounts it posts to</legend>
          {postable.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No account is connected yet. Connect one on the Accounts tab first.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {postable.map((a) => {
                const all = form.accountIds.length === 0;
                const on = all || form.accountIds.includes(a.id);
                return (
                  <label key={a.id} className="flex items-center gap-2">
                    <input
                      type="checkbox" className="h-4 w-4 accent-primary" checked={on}
                      onChange={(e) => {
                        const now = new Set(all ? postable.map((p) => p.id) : form.accountIds);
                        if (e.target.checked) now.add(a.id); else now.delete(a.id);
                        // Every account ticked is kept as "all", so an account connected later is used too.
                        set('accountIds', now.size === postable.length ? [] : [...now]);
                      }}
                    />
                    {isPlatform(a.provider) ? PLATFORM_NAME[a.provider] : a.provider}: {a.displayName}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      </Group>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-b-lg border-t border-border bg-card px-4 py-3">
        <Button onClick={onSave} disabled={saving || problems.length > 0 || !changed}>{saving && <Loader2 className="animate-spin" aria-hidden />}Save</Button>
        {!changed && <span className="text-xs text-muted-foreground">Saved.</span>}
        {changed && problems.length === 0 && <span className="text-xs text-muted-foreground">You have changes that are not saved yet.</span>}
        {problems.length > 0 && (
          <ul role="alert" className="min-w-0 flex-1 list-disc pl-5 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </div>
    </div>
  );
};

export default AutopilotSettingsForm;
