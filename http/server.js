import { useState, useEffect, useRef } from 'htm/preact';
import ReconnectingWebSocket from 'reconnecting-websocket';

/** @import { Mapping, Mappings } from './mapping.js'; */
import { EMPTY_MAPPING } from './mapping.js';

/**
 * @typedef {{
 *   command: Data,
 * }} CommandMessage
 */

/**
 * @typedef {{
 *   disconnect: { devices: string[] },
 * }} DisconnectMessage
 */

/**
 * @typedef {{
 *   reconnect: { devices: string[] },
 * }} ReconnectMessage
 */

/**
 * @typedef {{
 *   saveDefaultControls: Mapping[],
 * }} SaveDefaultControlsMessage
 */

/**
 * @typedef {{
 *   devices: string[],
 *   pan: number,
 *   tilt: number,
 *   roll: number,
 *   zoom: number,
 * }} Data
 */

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
 * }} RawServerState
 */

/**
 * @typedef {{
 *   instance: string,
 *   groups: Group[],
 *   devices: Record<string, {
 *     id: string,
 *     name: string,
 *     connected: boolean,
 *   }>,
 *   defaultControls: Mappings|null,
 * }} ServerState
 */

/**
 * @typedef {{
 *   name: string;
 *   devices: string[];
 * }} Group
 */

/**
 * @return {{
 *   state: ServerState,
 *   send: function(CommandMessage|DisconnectMessage|ReconnectMessage|SaveDefaultControlsMessage): void,
 * }}
 */
export function useServer() {
  const [state, setState] = useState(/** @type {ServerState} */({
    instance: '',
    groups: [],
    devices: {},
    defaultControls: null,
  }));
  const ws = useRef(/** @type {WebSocket|null} */(null));
  useEffect(() => {
    const websocket = new ReconnectingWebSocket("/control", [], {
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 2,
      maxEnqueuedMessages: 0,
    });

    /** @type {string|null} */
    let instanceId = null;
    websocket.addEventListener('message', (event) => {
      /** @type {RawServerState} */
      const rawData = JSON.parse(event.data);
      if (instanceId == null) {
        instanceId = rawData.instance;
      } else if (instanceId !== rawData.instance) {
        console.log('New server instance detected, reloading page');
        window.location.reload();
        return;
      }
      /** @type {ServerState} */
      const data = {
        ...rawData,
        defaultControls: rawData.defaultControls
          ? mapDefaultControls(rawData.groups, rawData.defaultControls)
          : null,
      };
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

/**
 * @param {Group[]} groups
 * @param {Mapping[]|undefined} defaultControls
 * @returns {Mappings}
 */
export function mapDefaultControls(groups, defaultControls) {
  if (defaultControls == null) {
    return {};
  }
  return Object.fromEntries(
    groups.map((group, i) => [group.name, defaultControls[i]])
  );
}

/**
 * @param {Group[]} groups
 * @param {Mappings} controls
 * @returns {Mapping[]}
 */
export function unmapDefaultControls(groups, controls) {
  return groups.map((group) => controls[group.name] || EMPTY_MAPPING);
}
