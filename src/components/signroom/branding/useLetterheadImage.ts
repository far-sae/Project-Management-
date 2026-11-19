// Fetches the workspace's stored letterhead PDF and keeps its first page as a picture.
import { useEffect, useState } from 'react';
import type { SignroomClient } from '@/services/signroom/client';
import { pdfPageImage } from './letterheadImage';

type Picture = { hash: string; url: string | null; failed: boolean };

/**
 * The stored letterhead with this hash as a picture. Nothing is fetched until
 * `wanted` is true. `failed` is set when the PDF cannot be fetched or drawn;
 * the letterhead itself is not affected by that.
 */
export function useLetterheadImage(client: SignroomClient, hash: string | null, wanted: boolean): { url: string | null; failed: boolean } {
  const [picture, setPicture] = useState<Picture | null>(null);

  useEffect(() => {
    if (!hash || !wanted) return;
    let alive = true;
    let made: string | null = null;
    client.pdf(`workspaces/branding-template?hash=${encodeURIComponent(hash)}`)
      .then(pdfPageImage)
      .then((url) => {
        made = url;
        if (alive) setPicture({ hash, url, failed: false });
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (alive) setPicture({ hash, url: null, failed: true });
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [client, hash, wanted]);

  return picture && picture.hash === hash ? { url: picture.url, failed: picture.failed } : { url: null, failed: false };
}
