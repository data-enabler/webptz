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

let counter = 0;
export function useId() {
  const [id] = useState(() => `id-${counter++}`);
  return id;
}

/**
 * @template T
 * @param {string} key
 * @param {T} defaultValue
 * @returns {[T, StateUpdater<T>]}
 */
export function useLocalStorage(key, defaultValue) {
  return useStorage(window.localStorage, key, defaultValue);
}

/**
 * @template T
 * @param {string} key
 * @param {T} defaultValue
 * @returns {[T, StateUpdater<T>]}
 */
export function useSessionStorage(key, defaultValue) {
  return useStorage(window.sessionStorage, key, defaultValue);
}

/**
 * @template T
 * @param {Storage} storage
 * @param {string} key
 * @param {T} defaultValue
 * @returns {[T, StateUpdater<T>]}
 */
function useStorage(storage, key, defaultValue) {
  const [ val, stateUpdater ] = useState(
    parseValue(storage.getItem(key)) ?? defaultValue
  );
  /** @type {StateUpdater<T>} */
  const storageUpdater = (valueOrUpdater) => {
    /** @type {T} */
    let v;
    if (valueOrUpdater instanceof Function) {
      v = valueOrUpdater(val);
    } else {
      v = valueOrUpdater;
    }
    stateUpdater(v);
    storage.setItem(key, JSON.stringify(v));
  };
  useEffect(() => {
    /** @param {StorageEvent} event */
    const handleEvent = (event) => {
      if (event.key !== key) {
        return;
      }
      stateUpdater(parseValue(event.newValue) ?? defaultValue);
    };
    window.addEventListener('storage', handleEvent);
    return () => window.removeEventListener('storage', handleEvent);
  }, []);

  return [ val, storageUpdater ];
}

/**
 * @template T
 * @param {string|null} value
 * @returns {T|null}
 */
function parseValue(value) {
  return JSON.parse(value ?? 'null');
}
