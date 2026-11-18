// tests/unit/taskAttachmentChips.test.tsx
// The task dialog's Attachments section: one compact chip per file. Images
// and PDFs open a preview; anything else opens in a new tab.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttachmentChips, attachmentKind } from '@/components/kanban/task-modal/AttachmentChips';

afterEach(cleanup);

const image = { fileId: 'f1', fileName: 'menu-desktop.png', fileUrl: 'https://files.test/menu-desktop.png', fileType: 'image/png' };
const pdf = { fileId: 'f2', fileName: 'brief.pdf', fileUrl: 'https://files.test/brief.pdf' };
const sheet = { fileId: 'f3', fileName: 'budget.xlsx', fileUrl: 'https://files.test/budget.xlsx' };

describe('attachmentKind', () => {
  it('reads the kind from the MIME type or the file extension', () => {
    expect(attachmentKind({ fileName: 'photo', fileType: 'image/jpeg' })).toBe('image');
    expect(attachmentKind({ fileName: 'Scan.JPG' })).toBe('image');
    expect(attachmentKind({ fileName: 'doc', fileType: 'application/pdf' })).toBe('pdf');
    expect(attachmentKind({ fileName: 'Contract.PDF' })).toBe('pdf');
    expect(attachmentKind({ fileName: 'budget.xlsx', fileType: 'application/vnd.ms-excel' })).toBe('other');
    expect(attachmentKind({ fileName: '' })).toBe('other');
  });
});

describe('AttachmentChips', () => {
  it('shows one chip per file with its full name', () => {
    render(<AttachmentChips attachments={[image, pdf, sheet]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'menu-desktop.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'brief.pdf' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'budget.xlsx' })).toBeTruthy();
  });

  it('opens other files in a new tab', () => {
    render(<AttachmentChips attachments={[sheet]} />);
    const link = screen.getByRole('link', { name: 'budget.xlsx' });
    expect(link.getAttribute('href')).toBe(sheet.fileUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('previews an image with a download link, and closes again', () => {
    render(<AttachmentChips attachments={[image, sheet]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'menu-desktop.png' }));
    const dialog = screen.getByRole('dialog', { name: 'menu-desktop.png' });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(image.fileUrl);
    const download = screen.getByRole('link', { name: /download/i });
    expect(download.getAttribute('href')).toBe(image.fileUrl);
    expect(download.getAttribute('download')).toBe('menu-desktop.png');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('previews a PDF in a frame', () => {
    render(<AttachmentChips attachments={[pdf]} />);
    fireEvent.click(screen.getByRole('button', { name: 'brief.pdf' }));
    const frame = screen.getByRole('dialog', { name: 'brief.pdf' }).querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(pdf.fileUrl);
    expect(frame?.getAttribute('title')).toBe('brief.pdf');
  });
});
