import { useState, useEffect, useRef } from 'htm/preact';
import ReconnectingWebSocket from 'reconnecting-websocket';

/** @import { Mapping, Mappings } from './mapping.js'; */
import { EMPTY_MAPPING } from './mapping.js';
/** @import { ControlState } from './state.js'; */

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
 * @typedef {Omit<ControlState, 'autofocus'> & {
 *   devices: string[],
 *   autofocus: boolean,
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
    const url = new URL(window.location.href);
    url.protocol = "ws";
    url.pathname = "/control";
    const websocket = new ReconnectingWebSocket(url.href, [], {
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
      const data = convertRawData(rawData);
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
      const json = JSON.stringify(data);
      console.log('Sending', json);
      ws.current.send(json);
    },
  };
}

/**
 * @param {RawServerState} rawData
 * @returns {ServerState}
 */
function convertRawData(rawData) {
  return {
    ...rawData,
    defaultControls: rawData.defaultControls
      ? mapDefaultControls(rawData.groups, rawData.defaultControls)
      : null,
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

/**
 * @param {RawServerState|undefined} initialState
 * @return {{
 *   state: ServerState,
 *   send: function(CommandMessage|DisconnectMessage|ReconnectMessage|SaveDefaultControlsMessage): void,
 * }}
 */
export function useMockServer(initialState=DEFAULT_STATE) {
  const [state, setState] = useState(() => convertRawData(initialState));
  return {
    state,
    send: command => {
      if ('disconnect' in command) {
        setState((/** @type {ServerState} */ state) => ({
          ...state,
          devices: {
            ...state.devices,
            ...Object.fromEntries(command.disconnect.devices.map(id => [id, {
              ...state.devices[id],
              connected: false,
            }]))
          }
        }));
      }
      if ('reconnect' in command) {
        setState((/** @type {ServerState} */ state) => ({
          ...state,
          devices: {
            ...state.devices,
            ...Object.fromEntries(command.reconnect.devices.map(id => [id, {
              ...state.devices[id],
              connected: true,
            }]))
          }
        }));
      }
    }
  };
}

/** @type {RawServerState} */
export const DEFAULT_STATE = {
  instance: 'mock',
  groups: [
    {
      name: 'Cam 1',
      devices: ['ronin1', 'lumix1', 'lanc1'],
    },
    {
      name: 'Cam 2',
      devices: ['ronin2', 'lumix2', 'lanc2'],
    },
    {
      name: 'All Cams Pan/Tilt',
      devices: ['ronin1', 'ronin2'],
    },
  ],
  devices: {
    ronin1: {
      id: 'ronin1',
      name: 'Ronin[DJI RSC 2]',
      connected: true,
    },
    ronin2: {
      id: 'ronin2',
      name: 'Ronin[DJI RS 3]',
      connected: true,
    },
    lumix1: {
      id: 'lumix1',
      name: 'Lumix[DC-BGH1]',
      connected: true,
    },
    lumix2: {
      id: 'lumix2',
      name: 'Lumix[DC-BS1H]',
      connected: true,
    },
    lanc1: {
      id: 'lanc1',
      name: 'LANC[COM1]',
      connected: true,
    },
    lanc2: {
      id: 'lanc2',
      name: 'LANC[COM2]',
      connected: true,
    },
  },
  defaultControls: [
    {
      panL: [{padIndex: 0, type: 'axis', inputIndex: 0, multiplier: -1.0}],
      panR: [{padIndex: 0, type: 'axis', inputIndex: 0, multiplier: 1.0}],
      tiltU: [{padIndex: 0, type: 'axis', inputIndex: 1, multiplier: -1.0}],
      tiltD: [{padIndex: 0, type: 'axis', inputIndex: 1, multiplier: 1.0}],
      rollL: [{padIndex: 0, type: 'button', inputIndex: 14, multiplier: 1.0}],
      rollR: [{padIndex: 0, type: 'button', inputIndex: 15, multiplier: 1.0}],
      zoomI: [{padIndex: 0, type: 'button', inputIndex: 6, multiplier: 1.0}],
      zoomO: [{padIndex: 0, type: 'button', inputIndex: 4, multiplier: 1.0}],
      focusF: [{padIndex: 0, type: 'button', inputIndex: 12, multiplier: 1.0}],
      focusN: [{padIndex: 0, type: 'button', inputIndex: 13, multiplier: 1.0}],
      focusA: [{padIndex: 0, type: 'button', inputIndex: 10, multiplier: 1.0}],
    },
    {
      panL: [{padIndex: 0, type: 'axis', inputIndex: 2, multiplier: -1.0}],
      panR: [{padIndex: 0, type: 'axis', inputIndex: 2, multiplier: 1.0}],
      tiltU: [{padIndex: 0, type: 'axis', inputIndex: 3, multiplier: -1.0}],
      tiltD: [{padIndex: 0, type: 'axis', inputIndex: 3, multiplier: 1.0}],
      rollL: [{padIndex: 0, type: 'button', inputIndex: 2, multiplier: 1.0}],
      rollR: [{padIndex: 0, type: 'button', inputIndex: 1, multiplier: 1.0}],
      zoomI: [{padIndex: 0, type: 'button', inputIndex: 7, multiplier: 1.0}],
      zoomO: [{padIndex: 0, type: 'button', inputIndex: 5, multiplier: 1.0}],
      focusF: [{padIndex: 0, type: 'button', inputIndex: 3, multiplier: 1.0}],
      focusN: [{padIndex: 0, type: 'button', inputIndex: 0, multiplier: 1.0}],
      focusA: [{padIndex: 0, type: 'button', inputIndex: 11, multiplier: 1.0}],
    },
  ],
};
