// @ts-ignore
import { html, render, useState, useEffect, useRef, useCallback } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';
// @ts-ignore
import ReconnectingWebSocket from 'https://unpkg.com/reconnecting-websocket@^4.4.0/dist/reconnecting-websocket-mjs.js';

import { GamepadData, Mapping, Mappings, normalizeGamepad, readInputs } from './mapping.js';

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
 * }} ServerState
 */

/**
 * @typedef {{
 *   name: string;
 *   devices: string[];
 * }} Group
 */

/**
 * @typedef {{
 *   pan: number,
 *   tilt: number,
 *   roll: number,
 *   zoom: number,
 * }} ControlState
 */

/**
 * @typedef {Record<string, ControlState>} ControlStates
 */

/**
 * @typedef {{
 *   lastTimestamp: number,
 *   lastState: ControlState,
 * }} SendState
 */

/**
 * @typedef {Record<string, SendState>} SendStates
 */

const EPSILON = 0.5 * 1/240; // Ideally this would be based on the display refresh rate
const POLL_INTERVAL = (1/60 - EPSILON) * 1000;
const SEND_INTERVAL = (1/5 - EPSILON) * 1000;
const ZERO_STATE = Object.freeze({
  pan: 0,
  tilt: 0,
  roll: 0,
  zoom: 0,
});

/**
 * @param {{
 *   groups: Group[],
 *   controlStates: ControlStates,
 *   setControlStates: function(ControlStates): void,
 *   send: function(CommandMessage): void,
 *   mappings: Mappings,
 * }} props
 */
function useGamepadPoll({ groups, setControlStates, send, mappings }) {
  const requestRef = useRef();
  const lastPoll = useRef(document.timeline.currentTime || 0);
  // Track the send times independently for each device group, so that we can send commands
  // immediately when they are non-zero
  const lastSends = useRef(/** @type {SendStates} */({}));
  const lastStates = useRef(/** @type {ControlStates} */({}));
  const mouseControlRef = useMouseControl();
  const poll = useCallback(() => {
    requestRef.current = requestAnimationFrame(poll);
    if (document.timeline.currentTime == null) {
      return;
    }
    const currentTime = /** @type {number} */(document.timeline.currentTime || 0);
    if (currentTime - lastPoll.current < POLL_INTERVAL) {
      return;
    }
    lastPoll.current = currentTime;
    const controlStates = readGamepads(mappings);
    if (mouseControlRef.current.groupId != null) {
      controlStates[mouseControlRef.current.groupId] =
        mouseStateToControlState(mouseControlRef.current);
    }

    // Limit unnecessary re-renders by only updating state when the values change
    if (!allStatesEqual(lastStates.current, controlStates)) {
      setControlStates(controlStates);
    }
    lastStates.current = controlStates;

    groups.forEach(({name: groupId, devices}) => {
      /** @type {ControlState} */
      const currState = controlStates[groupId] || ZERO_STATE;
      /** @type {Partial<SendState>} */
      const sendState = lastSends.current[groupId] || {};
      const {
        lastTimestamp = 0,
        lastState = {pan: 0, tilt: 0, roll: 0, zoom: 0},
      } = sendState;
      if (currentTime - lastTimestamp < SEND_INTERVAL) {
        return;
      }
      if (isZero(currState) && isZero(lastState)) {
        return;
      }
      send({
        command: {
          devices,
          ...currState,
        }
      });
      lastSends.current[groupId] = {
        lastTimestamp: currentTime,
        lastState: currState,
      };
    });
  }, [groups, setControlStates, mappings]);
  useEffect(() => {
    requestRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(requestRef.current);
  }, [poll]);
}

/**
 * @typedef {{
 *   groupId: string|null,
 *   type: 'pan-tilt'|'zoom',
 *   origin: number[],
 *   currXY: number[],
 *   range: number,
 * }}
 */
let MouseControl;

/**
 * @returns {{
 *   current: MouseControl,
 * }}
 */
function useMouseControl() {
  /** @type {MouseControl} */
  const initialVal = {
    groupId: null,
    type: 'pan-tilt',
    origin: [0, 0],
    currXY: [0, 0],
    range: 0,
  };
  /** @type {{current: MouseControl}} */
  const ref = useRef(initialVal);
  useEffect(() => {
    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const startDrag = function(e) {
      if (e.target == null) {
        return;
      }
      const target = /** @type {HTMLElement} */(e.target);
      if (!target.matches('.js-pt-joystick, .js-zoom-joystick')) {
        return;
      }
      e.preventDefault();
      const targetControl = /** @type {HTMLElement|null} */(target.closest('.js-control'));
      const groupId = targetControl?.dataset.groupId;
      if (!groupId) {
        return;
      }
      const origin = e instanceof MouseEvent
        ? [e.clientX, e.clientY]
        : [e.touches[0].clientX, e.touches[0].clientY];
      /** @type {MouseControl} */
      const control = {
        groupId,
        type: target.matches('.js-zoom-joystick') ? 'zoom' : 'pan-tilt',
        origin,
        currXY: origin,
        range: (target.parentElement?.clientHeight || 0) / 2,
      };
      Object.assign(ref.current, control);
    };
    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const move = function(e) {
      if (ref.current.groupId != null) {
        e.preventDefault();
        ref.current.currXY = e instanceof MouseEvent
          ? [e.clientX, e.clientY]
          : [e.touches[0].clientX, e.touches[0].clientY];
      }
    };
    const endDrag = function() {
      ref.current.groupId = null;
    };
    document.documentElement.addEventListener('mousedown', startDrag);
    document.documentElement.addEventListener('touchstart', startDrag, { passive: false });
    document.documentElement.addEventListener('mousemove', move);
    document.documentElement.addEventListener('touchmove', move, { passive: false });
    document.documentElement.addEventListener('mouseup', endDrag);
    document.documentElement.addEventListener('touchend', endDrag);
    document.documentElement.addEventListener('mouseleave', endDrag);
    document.documentElement.addEventListener('touchcancel', endDrag);
    return function cleanup() {
      document.documentElement.removeEventListener('mousedown', startDrag);
      document.documentElement.removeEventListener('touchstart', startDrag);
      document.documentElement.removeEventListener('mousemove', move);
      document.documentElement.removeEventListener('touchmove', move);
      document.documentElement.removeEventListener('mouseup', endDrag);
      document.documentElement.removeEventListener('touchend', endDrag);
      document.documentElement.removeEventListener('mouseleave', endDrag);
      document.documentElement.removeEventListener('touchcancel', endDrag);
    };
  }, []);
  return ref;
}

/**
 * @param {MouseControl} c
 * @return {ControlState}
 */
function mouseStateToControlState(c) {
  if (c.range === 0) {
    return {
      pan: 0,
      tilt: 0,
      roll: 0,
      zoom: 0,
    }
  }
  let pan = 0;
  let tilt = 0;
  let zoom = 0;
  if (c.type === 'pan-tilt') {
    const deltaX = c.currXY[0] - c.origin[0];
    const deltaY = -1 * (c.currXY[1] - c.origin[1]);
    const angle = Math.atan2(deltaY, deltaX);
    const unclamped = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / c.range;
    const magnitude = Math.min(Math.max(unclamped, -1), 1);
    pan = magnitude * Math.cos(angle);
    tilt = magnitude * Math.sin(angle);
  }
  if (c.type === 'zoom') {
    const unclamped = -1 * (c.currXY[1] - c.origin[1]) / c.range;
    zoom = Math.min(Math.max(unclamped, -1), 1);
  }
  return {
    pan,
    tilt,
    roll: 0,
    zoom,
  };
}

/**
 * @return {{
 *   state: ServerState,
 *   send: function(CommandMessage|DisconnectMessage|ReconnectMessage): void,
 * }}
 */
function useServer() {
  const [state, setState] = useState(/** @type {ServerState} */ ({
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
  }
}

function App() {
  const { state, send } = useServer();
  const [controlStates, setControlStates] = useState(/** @type {ControlStates} */ (
    Object.fromEntries(state.groups.map((g) => [g.name, ZERO_STATE]))
  ));
  const [localMappings] = useState(null);
  const serverMappings = mapDefaultControls(state.groups, state.defaultControls);
  const mappings = localMappings || serverMappings;
  useGamepadPoll({
    groups: state.groups,
    controlStates,
    setControlStates,
    send,
    mappings,
  });
  const onDisconnect = (id) => {
    send({ disconnect: { devices: [id] } });
  };
  const onReconnect = (id) => {
    send({ reconnect: { devices: [id] } });
  };

  return state.groups.map(({ name: groupId, devices }) => {
    const s = controlStates[groupId] || ZERO_STATE;
    return html`
      <div class="control js-control"
        data-group-id=${groupId}
        style=${{
          '--pan': s.pan,
          '--tilt': s.tilt,
          '--roll': s.roll,
          '--zoom': s.zoom,
        }}
      >
        <h2 class="control__name">${groupId}</h2>
        <div>
          ${devices.map((id) => {
            const d = state.devices[id];
            return html`
              <div class="control__device">
                ${d.name}
                <br/>
                <button disabled=${!d.connected} onClick=${() => onDisconnect(d.id)}>Disconnect</button>
                ${' '}
                <button disabled=${d.connected} onClick=${() => onReconnect(d.id)}>Reconnect</button>
              </div>
            `;
          })}
        </div>
        <div class="control__controls">
          <div class="control__pt">
            <div class="control__pt-bg"></div>
            <div class="control__pt-joystick js-pt-joystick"></div>
          </div>
          <div class="control__zoom">
            <div class="control__zoom-joystick js-zoom-joystick"></div>
          </div>
        </div>
      </div>
    `;
  });
}

render(html`<${App} />`, document.body);

window.addEventListener("gamepadconnected", (e) => {
  console.log(
    "Gamepad connected at index %d: %s. %d buttons, %d axes.",
    e.gamepad.index,
    e.gamepad.id,
    e.gamepad.buttons.length,
    e.gamepad.axes.length,
  );
});

/**
 * @param {Mappings} mappings
 * @returns {ControlStates}
 */
function readGamepads(mappings) {
  const pads = navigator.getGamepads().map(normalizeGamepad);
  return Object.fromEntries(
    Object.entries(mappings)
      .map(([groupId, m]) => [groupId, readMapping(pads, m)])
  );
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {Mapping} mapping
 * @returns {ControlState}
 */
function readMapping(pads, mapping) {
  const pan = -1 * readInputs(pads, mapping.panL) + readInputs(pads, mapping.panR);
  const tilt = -1 * readInputs(pads, mapping.tiltD) + readInputs(pads, mapping.tiltU);
  const roll = -1 * readInputs(pads, mapping.rollL) + readInputs(pads, mapping.rollR);
  const zoom = -1 * readInputs(pads, mapping.zoomO) + readInputs(pads, mapping.zoomI);

  return {
    pan,
    tilt,
    roll,
    zoom,
  };
}

/**
 * @param {Group[]} groups
 * @param {Mapping[]|undefined} defaultControls
 * @returns {Mappings}
 */
function mapDefaultControls(groups, defaultControls) {
  if (defaultControls == null) {
    return {};
  }
  return Object.fromEntries(
    groups.map((group, i) => [group.name, defaultControls[i]])
  );
}

/**
 * @param {ControlStates} states1
 * @param {ControlStates} states2
 * @returns {boolean}
 */
function allStatesEqual(states1, states2) {
  return Object.keys(states1).length === Object.keys(states2).length &&
    Object.entries(states1).every(
      ([groupId, state1]) => statesEqual(state1, states2[groupId])
    );
}

/**
 * @param {ControlState|undefined} state1
 * @param {ControlState|undefined} state2
 * @returns {boolean}
 */
function statesEqual(state1, state2) {
  if (state1 == null || state2 == null) {
    return state1 == state2;
  }
  return state1.pan === state2.pan && state1.tilt === state2.tilt && state1.roll === state2.roll && state1.zoom === state2.zoom;
}

/**
 * @param {ControlState} state
 * @returns {boolean}
 */
function isZero(state) {
  return statesEqual(state, ZERO_STATE);
}
