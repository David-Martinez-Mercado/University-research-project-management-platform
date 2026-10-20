import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// findBy*/waitFor default to 1 s, which flakes when the machine is busy.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});
