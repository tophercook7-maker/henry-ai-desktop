import type { HenryAPI } from './index';

declare global {
  interface Window {
    henryAPI: HenryAPI;
  }
}

export {};
