import { useEffect, useState } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';

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
