// @ts-ignore
import { useState, useEffect, useRef } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';
// @ts-ignore
import ReconnectingWebSocket from 'https://unpkg.com/reconnecting-websocket@^4.4.0/dist/reconnecting-websocket-mjs.js';

import { Mapping } from './mapping.js';

/**
 * @typedef {{
 *   command: Data,
 * }}
 */
export let CommandMessage;

/**
 * @typedef {{
 *   disconnect: { devices: string[] },
 * }}
 */
export let DisconnectMessage;

/**
 * @typedef {{
 *   reconnect: { devices: string[] },
 * }}
 */
export let ReconnectMessage;

/**
 * @typedef {{
 *   devices: string[],
 *   pan: number,
 *   tilt: number,
 *   roll: number,
 *   zoom: number,
 * }}
 */
export let Data;

/**
 * @typedef {{
 *   instance: string,
 *   groups: Group[],
 *   devices: Record<string, {
 *     id: string,
 *     name: string,
 *     connected: boolean,
 *   }>,
 *   defaultControls?: Mapping[],
 * }}
 */
export let ServerState;

/**
 * @typedef {{
 *   name: string;
 *   devices: string[];
 * }}
 */
export let Group;

/**
 * @return {{
 *   state: ServerState,
 *   send: function(CommandMessage|DisconnectMessage|ReconnectMessage): void,
 * }}
 */
export function useServer() {
  const [state, setState] = useState(/** @type {ServerState} */({
    instance: '',
    groups: [],
    devices: {},
  }));
  const ws = useRef(null);
  useEffect(() => {
    const websocket = new ReconnectingWebSocket("/control", [], {
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 2,
      maxEnqueuedMessages: 0,
    });
    let instanceId;
    websocket.addEventListener('message', (event) => {
      /** @type {ServerState} */
      const data = JSON.parse(event.data);
      if (instanceId == null) {
        instanceId = data.instance;
      } else if (instanceId !== data.instance) {
        console.log('New server instance detected, reloading page');
        window.location.reload();
      }
      setState(data);
    });
    ws.current = websocket;
    return () => {
      ws.current = null;
      websocket.close();
    };
  }, []);

  return {
    state,
    send: (data) => {
      if (!ws.current) {
        return;
      }
      console.log('Sending', data);
      ws.current.send(JSON.stringify(data));
    },
  };
}
