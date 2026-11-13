import React, { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDragToScroll } from '@/hooks/useDragToScroll';
import { useScrollEdges } from '@/hooks/useScrollEdges';

afterEach(cleanup);

function PanBoard() {
  const ref = useDragToScroll<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="board">
      <div data-testid="gap">empty board space</div>
      <div data-testid="card" aria-roledescription="sortable">
        task card
      </div>
      <button type="button">Add task</button>
      <input aria-label="title" />
    </div>
  );
}

const press = (el: Element, x: number, y: number) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' });
const move = (el: Element, x: number, y: number) =>
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
const release = (el: Element) => fireEvent.pointerUp(el, { pointerId: 1 });

describe('useDragToScroll', () => {
  it('slides the board when dragging on empty space', () => {
    render(<PanBoard />);
    const board = screen.getByTestId('board');
    board.scrollLeft = 300;
    board.scrollTop = 100;
    press(screen.getByTestId('gap'), 500, 400);
    move(board, 380, 360);
    expect(board.scrollLeft).toBe(420);
    expect(board.scrollTop).toBe(140);
    release(board);
    move(board, 0, 0);
    expect(board.scrollLeft).toBe(420);
  });

  it('does not open a card or button with the click that ends a slide', () => {
    let clicks = 0;
    function Board() {
      const ref = useDragToScroll<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="board" onClick={() => clicks++}>
          <div data-testid="gap">space</div>
        </div>
      );
    }
    render(<Board />);
    const board = screen.getByTestId('board');
    const gap = screen.getByTestId('gap');
    press(gap, 500, 400);
    move(board, 300, 400);
    release(board);
    fireEvent.click(gap);
    expect(clicks).toBe(0);
    fireEvent.click(gap);
    expect(clicks).toBe(1);
  });

  it('ignores small jitters so clicks still work', () => {
    render(<PanBoard />);
    const board = screen.getByTestId('board');
    board.scrollLeft = 300;
    press(screen.getByTestId('gap'), 500, 400);
    move(board, 497, 400);
    expect(board.scrollLeft).toBe(300);
  });

  it('never starts on task cards, buttons or text fields', () => {
    render(<PanBoard />);
    const board = screen.getByTestId('board');
    for (const target of [screen.getByTestId('card'), screen.getByRole('button'), screen.getByLabelText('title')]) {
      board.scrollLeft = 300;
      press(target, 500, 400);
      move(board, 300, 400);
      release(board);
      expect(board.scrollLeft).toBe(300);
    }
  });

  it('only reacts to the main (left) button', () => {
    render(<PanBoard />);
    const board = screen.getByTestId('board');
    board.scrollLeft = 300;
    fireEvent.pointerDown(screen.getByTestId('gap'), { clientX: 500, clientY: 400, button: 2, pointerId: 1 });
    move(board, 300, 400);
    expect(board.scrollLeft).toBe(300);
  });
});

function Column() {
  const ref = useRef<HTMLDivElement>(null);
  const { canScrollDown, scrollDown } = useScrollEdges(ref);
  return (
    <div>
      <div ref={ref} data-testid="list" />
      {canScrollDown && (
        <button type="button" onClick={scrollDown}>
          More tasks
        </button>
      )}
    </div>
  );
}

function sizeList(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

describe('useScrollEdges', () => {
  it('shows "More tasks" only while cards are hidden below', () => {
    render(<Column />);
    const list = screen.getByTestId('list');
    sizeList(list, { scrollHeight: 1000, clientHeight: 400 });
    act(() => {
      fireEvent.scroll(list);
    });
    expect(screen.getByRole('button', { name: 'More tasks' })).toBeTruthy();

    list.scrollTop = 600;
    act(() => {
      fireEvent.scroll(list);
    });
    expect(screen.queryByRole('button', { name: 'More tasks' })).toBeNull();
  });

  it('scrolls most of a screen down when clicked', () => {
    render(<Column />);
    const list = screen.getByTestId('list');
    sizeList(list, { scrollHeight: 1000, clientHeight: 400 });
    let scrolledBy: number | undefined;
    list.scrollBy = ((opts: ScrollToOptions) => {
      scrolledBy = opts.top;
    }) as typeof list.scrollBy;
    act(() => {
      fireEvent.scroll(list);
    });
    fireEvent.click(screen.getByRole('button', { name: 'More tasks' }));
    expect(scrolledBy).toBe(320);
  });

  it('stays hidden when everything fits', () => {
    render(<Column />);
    const list = screen.getByTestId('list');
    sizeList(list, { scrollHeight: 300, clientHeight: 400 });
    act(() => {
      fireEvent.scroll(list);
    });
    expect(screen.queryByRole('button', { name: 'More tasks' })).toBeNull();
  });
});
