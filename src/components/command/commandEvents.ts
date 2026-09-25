// The window events that open the command palette and the shortcuts modal.
//
// They live here, in a module that imports nothing from the components that
// use them, because they used to live in the components themselves — and that
// made AppHeader and CommandPalette import each other:
//
//   AppHeader      → openShortcutsModal   (from CommandPalette)
//   CommandPalette → COMMAND_OPEN_EVENT   (from AppHeader)
//
// A cycle like that is survivable right up until it is not. Whichever module
// the bundler evaluates first reads a `const` from the other before it has
// been initialised, and the result is a temporal dead zone error at render:
//
//   ReferenceError: Cannot access 'ue' before initialization
//       at AppHeader-BdUH63AU.js
//
// which React Router catches as a render failure and shows as a broken page.
// It appeared only in the production build, because dev serves modules
// separately and happens to evaluate them in an order that works — so `npm run
// build` passed, every test passed, and the deployed app was broken.
//
// Nothing in this file may import a component. That is the whole point of it.

export const COMMAND_OPEN_EVENT = 'app:open-command-palette';
export const SHORTCUTS_OPEN_EVENT = 'app:open-shortcuts';

/** Asks the command palette to open, from anywhere. */
export const openCommandPalette = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COMMAND_OPEN_EVENT));
};

/** Asks the keyboard-shortcuts modal to open, from anywhere. */
export const openShortcutsModal = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SHORTCUTS_OPEN_EVENT));
};
