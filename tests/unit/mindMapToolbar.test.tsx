import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// Radix menus portal + need pointer APIs jsdom lacks; render them inline so
// the test can see every item.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children?: React.ReactNode;
      onSelect?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange,
    }: {
      children?: React.ReactNode;
      checked?: boolean;
      onCheckedChange?: () => void;
    }) => (
      <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange?.()}>
        {children}
      </button>
    ),
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuShortcut: Pass,
  };
});

import { MindMapModeSwitch, MindMapToolbar, type MindMapToolbarProps } from '@/components/mindmap/MindMapToolbar';

afterEach(cleanup);

function setup(over: Partial<MindMapToolbarProps> = {}) {
  const props: MindMapToolbarProps = {
    onAddIdea: vi.fn(),
    onAddShape: vi.fn(),
    connectMode: false,
    onToggleConnect: vi.fn(),
    onTidyUp: vi.fn(),
    canUndo: false,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    zoom: 1.25,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onFitView: vi.fn(),
    find: { open: false, onOpenChange: vi.fn(), items: [], onSelect: vi.fn() },
    onExportPng: vi.fn(),
    onExportJson: vi.fn(),
    hiddenLinkCount: 0,
    onRestoreLinks: vi.fn(),
    canClearPlaceholders: true,
    onClearPlaceholders: vi.fn(),
    onResetLayout: vi.fn(),
    showMiniMap: true,
    onToggleMiniMap: vi.fn(),
    onShowShortcuts: vi.fn(),
    isFullscreen: false,
    onToggleFullscreen: vi.fn(),
    ...over,
  };
  render(<MindMapToolbar {...props} />);
  return props;
}

describe('MindMapToolbar', () => {
  it('labels every icon-only button and gives it a tooltip', () => {
    setup();
    for (const name of ['Undo', 'Redo', 'Zoom out', 'Zoom in', 'Fit to screen', 'Find on map', 'More options', 'Fullscreen', 'More shapes']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('title')).toBeTruthy();
    }
  });

  it('wires the primary actions', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Add idea$/ }));
    expect(p.onAddIdea).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    expect(p.onToggleConnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tidy up/ }));
    expect(p.onTidyUp).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(p.onToggleFullscreen).toHaveBeenCalled();
  });

  it('shows live zoom and resets to 100% on click', () => {
    const p = setup();
    const zoom = screen.getByRole('button', { name: /Zoom 125%/ });
    expect(zoom.textContent).toBe('125%');
    fireEvent.click(zoom);
    expect(p.onZoomReset).toHaveBeenCalled();
  });

  it('disables undo / redo when unavailable', () => {
    const p = setup({ canUndo: false, canRedo: true });
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(p.onRedo).toHaveBeenCalled();
  });

  it('offers the other placeholder shapes with the board-safety note', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: /Task card/ }));
    expect(p.onAddShape).toHaveBeenCalledWith('task');
    fireEvent.click(screen.getByRole('menuitem', { name: /Column/ }));
    expect(p.onAddShape).toHaveBeenCalledWith('column');
    fireEvent.click(screen.getByRole('menuitem', { name: /Project header/ }));
    expect(p.onAddShape).toHaveBeenCalledWith('project');
    expect(screen.getByText(/the board isn’t changed/)).toBeTruthy();
  });

  it('only lists "Restore hidden links" when some are hidden', () => {
    setup({ hiddenLinkCount: 0 });
    expect(screen.queryByRole('menuitem', { name: /Restore hidden links/ })).toBeNull();
    cleanup();
    const p = setup({ hiddenLinkCount: 3 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Restore hidden links \(3\)/ }));
    expect(p.onRestoreLinks).toHaveBeenCalled();
  });

  it('routes overflow actions', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: /Export PNG/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Export JSON/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear placeholders/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Reset layout/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Show minimap/ }));
    expect(p.onExportPng).toHaveBeenCalled();
    expect(p.onExportJson).toHaveBeenCalled();
    expect(p.onClearPlaceholders).toHaveBeenCalled();
    expect(p.onResetLayout).toHaveBeenCalled();
    expect(p.onShowShortcuts).toHaveBeenCalled();
    expect(p.onToggleMiniMap).toHaveBeenCalled();
  });

  it('find lists ranked matches and picks one with the keyboard', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    setup({
      find: {
        open: true,
        onOpenChange,
        onSelect,
        items: [
          { id: 'task-1', label: 'Redesign pricing', kind: 'task' },
          { id: 'idea-1', label: 'Design system', kind: 'idea' },
        ],
      },
    });
    const input = screen.getByRole('combobox', { name: 'Find on map' });
    fireEvent.change(input, { target: { value: 'design' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Design systemIdea', 'Redesign pricingTask']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('task-1', true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the mode switch inside the bar', () => {
    const onChange = vi.fn();
    setup({ modeSwitch: <MindMapModeSwitch mode="project" onChange={onChange} /> });
    const group = screen.getByRole('radiogroup', { name: 'Mind map mode' });
    expect(screen.getByRole('toolbar', { name: 'Mind map tools' }).contains(group)).toBe(true);
    fireEvent.click(within(group).getAllByRole('radio')[1]);
    expect(onChange).toHaveBeenCalledWith('ai');
  });
});
