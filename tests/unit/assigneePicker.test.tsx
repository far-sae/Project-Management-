import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssigneePicker } from '@/components/kanban/AssigneePicker';

afterEach(cleanup);

const value = [
  { userId: 'u1', displayName: 'Tamanna Yadav', photoURL: '' },
  { userId: 'u2', displayName: 'Securovix Securovix With A Very Long Name', photoURL: '' },
] as never;

describe('AssigneePicker chips', () => {
  it('chips can shrink to the panel and long names are truncated with the full name on hover', () => {
    render(<AssigneePicker value={value} members={[]} onChange={vi.fn()} />);
    const name = screen.getByText('Securovix Securovix With A Very Long Name');
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe('Securovix Securovix With A Very Long Name');
    const chip = name.closest('[data-assignee-chip]') as HTMLElement;
    expect(chip.className).toContain('max-w-full');
    expect(chip.className).toContain('min-w-0');
  });

  it('removes an assignee with the chip ×, and hides × when read-only', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AssigneePicker value={value} members={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tamanna Yadav' }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ userId: 'u2' })]);
    rerender(<AssigneePicker value={value} members={[]} onChange={onChange} disabled />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });
});
