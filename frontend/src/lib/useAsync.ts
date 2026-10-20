import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  /** True while a request is in flight (data from the previous request stays available). */
  loading: boolean;
  reload: () => void;
  /** Replace the data locally (e.g. with a mutation response) without a request. */
  setData: (data: T) => void;
}

/** Runs `load` on mount and whenever `deps` change; ignores results of superseded requests. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRef.current().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
