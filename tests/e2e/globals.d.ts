import type { OneLoomApi } from '../../src/shared/api';

declare global {
  interface Window {
    oneloom: OneLoomApi;
  }
}

export {};
