// The dev hooks the client puts on window (packages/client/src/main.js), as seen from Playwright.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    game: any;
    dev: { boot(): Promise<void>; settle(n?: number): Promise<void> } & Record<string, any>;
    step(frames?: number, dt?: number): Promise<void>;
  }
}
export {};
