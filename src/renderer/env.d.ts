import type { BrowserApi } from "../shared/types";

declare global {
  interface Window {
    browser: BrowserApi;
  }
}

export {};