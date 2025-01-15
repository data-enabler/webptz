import { useEffect, useState } from 'htm/preact';

/**
 * @template T
 * @typedef {(value: T | ((prevState: T) => T)) => void} StateUpdater
 */

/**
 * @template T
 * @param {T} original
 * @returns {[T, StateUpdater<T>]}
 */
export function useLocalState(original) {
  const [local, setLocal] = useState(original);
  useEffect(() => setLocal(original), [original]);
  return [local, setLocal];
}
