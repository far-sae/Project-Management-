// HR documents: expiry pill, filters and the upload form's rules. All pure.
import { describe, expect, it } from 'vitest';
import {
  buildUploadInput,
  documentExpiry,
  fileBaseName,
  filterDocuments,
  validateUpload,
} from '@/components/hr/documents/documentHelpers';
import { HR_DOCUMENT_MAX_BYTES, type EmployeeDocument } from '@/services/supabase/hrDocuments';

const TODAY = '2026-11-18';

const doc = (id: string, over: Partial<EmployeeDocument> = {}): EmployeeDocument => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  title: `Doc ${id}`,
  category: 'contract',
  fileName: `${id}.pdf`,
  filePath: `o1/ana/${id}.pdf`,
  fileSize: 1024,
  fileType: 'application/pdf',
  expiresOn: null,
  uploadedBy: 'ana',
  createdAt: new Date('2026-01-05T10:00:00Z'),
  ...over,
});

const fileOfSize = (name: string, size: number): File => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('documentExpiry', () => {
  it('says nothing when there is no expiry date or it is far off', () => {
    expect(documentExpiry(null, TODAY)).toBeNull();
    expect(documentExpiry('2026-12-19', TODAY)).toBeNull();
  });

  it('warns within 30 days and turns red once the date has passed', () => {
    expect(documentExpiry('2026-12-18', TODAY)).toEqual({ tone: 'warning', label: 'In 30 days', daysLeft: 30 });
    expect(documentExpiry('2026-11-19', TODAY)).toEqual({ tone: 'warning', label: 'In 1 day', daysLeft: 1 });
    expect(documentExpiry(TODAY, TODAY)).toEqual({ tone: 'warning', label: 'Expires today', daysLeft: 0 });
    expect(documentExpiry('2026-11-17', TODAY)).toEqual({ tone: 'danger', label: 'Expired', daysLeft: -1 });
  });
});

describe('filterDocuments', () => {
  const documents = [
    doc('1', { userId: 'ana', category: 'contract', title: 'Employment contract', fileName: 'ana-contract.pdf' }),
    doc('2', { userId: 'bob', category: 'id', title: 'Passport', fileName: 'scan_0042.JPG' }),
    doc('3', { userId: 'bob', category: 'contract', title: 'Contract 2026', fileName: 'bob.pdf' }),
  ];
  const all = { userId: 'all', category: 'all', search: '' } as const;

  it('returns everything with no filters', () => {
    expect(filterDocuments(documents, all)).toHaveLength(3);
  });

  it('filters by employee and by category', () => {
    expect(filterDocuments(documents, { ...all, userId: 'bob' }).map((d) => d.id)).toEqual(['2', '3']);
    expect(filterDocuments(documents, { ...all, category: 'contract' }).map((d) => d.id)).toEqual(['1', '3']);
    expect(filterDocuments(documents, { ...all, userId: 'bob', category: 'contract' }).map((d) => d.id)).toEqual(['3']);
  });

  it('searches the title and the file name, ignoring case', () => {
    expect(filterDocuments(documents, { ...all, search: ' CONTRACT ' }).map((d) => d.id)).toEqual(['1', '3']);
    expect(filterDocuments(documents, { ...all, search: 'scan_00' }).map((d) => d.id)).toEqual(['2']);
    expect(filterDocuments(documents, { ...all, search: 'nothing' })).toEqual([]);
  });
});

describe('fileBaseName', () => {
  it('drops the extension', () => {
    expect(fileBaseName('Contract.pdf')).toBe('Contract');
    expect(fileBaseName('ana.contract.final.docx')).toBe('ana.contract.final');
    expect(fileBaseName('README')).toBe('README');
    expect(fileBaseName('.env')).toBe('.env');
  });
});

describe('upload form', () => {
  const file = fileOfSize('Passport scan.pdf', 2048);
  const form = { userId: 'bob', title: '', category: 'id', expiresOn: '', file } as const;

  it('needs an employee and a file', () => {
    expect(validateUpload({ ...form, userId: '' })).toEqual({ userId: 'Choose an employee.' });
    expect(validateUpload({ ...form, file: null })).toEqual({ file: 'Choose a file.' });
    expect(validateUpload(form)).toEqual({});
  });

  it('refuses a file over 25 MB', () => {
    const big = fileOfSize('video.mov', HR_DOCUMENT_MAX_BYTES + 1);
    expect(validateUpload({ ...form, file: big })).toEqual({ file: 'That file is larger than 25 MB.' });
    const exact = fileOfSize('ok.pdf', HR_DOCUMENT_MAX_BYTES);
    expect(validateUpload({ ...form, file: exact })).toEqual({});
  });

  it('uses the file name as the title when none is typed, and no expiry when blank', () => {
    expect(buildUploadInput(form)).toEqual({
      userId: 'bob',
      title: 'Passport scan',
      category: 'id',
      expiresOn: null,
      file,
    });
    expect(buildUploadInput({ ...form, title: '  Passport  ', expiresOn: '2030-05-01' })).toEqual({
      userId: 'bob',
      title: 'Passport',
      category: 'id',
      expiresOn: '2030-05-01',
      file,
    });
  });
});
