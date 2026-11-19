// The company's details and the look every document shares: logo, body text, footer.
import React, { useId } from 'react';
import { Trash2 } from 'lucide-react';
import {
  DOCUMENT_FONTS, FONT_SIZES, type BrandingForm, type DocumentFont,
} from '@/lib/signroom/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, FIELD } from '@/components/signroom/billing/shared';

interface Props {
  form: BrandingForm;
  set: <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) => void;
  /** A chosen logo file, or "remove" for none. */
  onLogo: (file: File | undefined | 'remove') => void;
  locked: boolean;
}

const GROUP = 'flex flex-col gap-3';
const GROUP_TITLE = 'text-xs font-medium text-muted-foreground';
const PAIR = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

export const LookCard: React.FC<Props> = ({ form, set, onLogo, locked }) => {
  const id = useId();
  return (
    <Card title="Company details and look">
      <div className="flex flex-col gap-6 p-4">
        <section className={GROUP} aria-labelledby={`${id}-g-company`}>
          <h3 id={`${id}-g-company`} className={GROUP_TITLE}>Your company</h3>
          <div className={FIELD}>
            <Label htmlFor={`${id}-company-name`}>Company name on documents</Label>
            <Input id={`${id}-company-name`} required maxLength={1000} disabled={locked} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-address`}>Company address</Label>
            <Textarea id={`${id}-address`} rows={3} maxLength={1000} disabled={locked} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className={PAIR}>
            <div className={FIELD}>
              <Label htmlFor={`${id}-company-number`}>Company registration number</Label>
              <Input id={`${id}-company-number`} maxLength={1000} disabled={locked} value={form.companyNumber} onChange={(e) => set('companyNumber', e.target.value)} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-tax-number`}>Tax or VAT number</Label>
              <Input id={`${id}-tax-number`} maxLength={1000} disabled={locked} value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
            </div>
          </div>
        </section>

        <section className={GROUP} aria-labelledby={`${id}-g-logo`}>
          <h3 id={`${id}-g-logo`} className={GROUP_TITLE}>Logo</h3>
          <div className={FIELD}>
            <Label htmlFor={`${id}-logo`}>Company logo (PNG or JPEG, up to 300 KB)</Label>
            <Input
              id={`${id}-logo`} type="file" accept="image/png,image/jpeg" disabled={locked}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; onLogo(file); }}
            />
            <p className="text-xs text-muted-foreground">Without a logo, its place on the letterhead stays empty and your company name stands alone.</p>
          </div>
          {form.logo && (
            <div className="flex flex-wrap items-center gap-3">
              <img src={form.logo} alt="Company logo" className="max-h-20 max-w-44 rounded-md border border-border bg-background object-contain p-2" />
              <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => onLogo('remove')}>
                <Trash2 aria-hidden /> Remove logo
              </Button>
            </div>
          )}
        </section>

        <section className={GROUP} aria-labelledby={`${id}-g-body`}>
          <h3 id={`${id}-g-body`} className={GROUP_TITLE}>Body text</h3>
          <div className={PAIR}>
            <div className={FIELD}>
              <Label htmlFor={`${id}-font`}>Font</Label>
              <Select value={form.fontFamily} onValueChange={(v) => set('fontFamily', v as DocumentFont)} disabled={locked}>
                <SelectTrigger id={`${id}-font`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_FONTS.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-font-size`}>Text size</Label>
              <Select value={String(form.fontSize)} onValueChange={(v) => set('fontSize', Number(v))} disabled={locked}>
                <SelectTrigger id={`${id}-font-size`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} pt</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Body text style">
            <Button
              type="button" size="sm" variant={form.bodyBold ? 'default' : 'outline'} aria-pressed={form.bodyBold} disabled={locked}
              onClick={() => set('bodyBold', !form.bodyBold)}
            >
              Bold body text
            </Button>
            <Button
              type="button" size="sm" variant={form.bodyItalic ? 'default' : 'outline'} aria-pressed={form.bodyItalic} disabled={locked}
              onClick={() => set('bodyItalic', !form.bodyItalic)}
            >
              Italic body text
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            These apply to the body of every document. Each item on the letterhead has its own font, set in the Letterhead section.
          </p>
        </section>

        <section className={GROUP} aria-labelledby={`${id}-g-text`}>
          <h3 id={`${id}-g-text`} className={GROUP_TITLE}>Text on every document</h3>
          <div className={FIELD}>
            <Label htmlFor={`${id}-footer`}>Footer</Label>
            <Input id={`${id}-footer`} maxLength={1000} disabled={locked} placeholder="Your website or a short line" value={form.footer} onChange={(e) => set('footer', e.target.value)} />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-payment`}>How to pay (shown on invoices)</Label>
            <Textarea
              id={`${id}-payment`} rows={4} maxLength={3000} disabled={locked}
              placeholder="Bank details, the reference to quote, or who to contact"
              value={form.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)}
            />
          </div>
        </section>
      </div>
    </Card>
  );
};

export default LookCard;
