// @ts-ignore
import { html, render, useState, useEffect, useRef, useCallback } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';
// @ts-ignore
import ReconnectingWebSocket from 'https://unpkg.com/reconnecting-websocket@^4.4.0/dist/reconnecting-websocket-mjs.js';

import { GamepadData, Mapping, normalizeGamepad, readInputs } from './mapping.js';

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
 *   groups: string[][],
 *   devices: Record<string, {
 *     id: string,
 *     name: string,
 *     connected: boolean,
 *   }>,
 * }} DeviceGroupState
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
 * @typedef {{
 *   lastTimestamp: number,
 *   lastState: ControlState,
 * }} SendState
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
/** @type {Mapping[]} */
const MAPPINGS = [
  {
    panL: [
      { padIndex: 0, type: 'axis', inputIndex: 0, sign: 'negative' },
    ],
    panR: [
      { padIndex: 0, type: 'axis', inputIndex: 0, sign: 'positive' },
    ],
    tiltU: [
      { padIndex: 0, type: 'axis', inputIndex: 1, sign: 'negative' },
    ],
    tiltD: [
      { padIndex: 0, type: 'axis', inputIndex: 1, sign: 'positive' },
    ],
    rollL: [],
    rollR: [],
    zoomI: [
      { padIndex: 0, type: 'button', inputIndex: 6, sign: 'positive' },
    ],
    zoomO: [
      { padIndex: 0, type: 'button', inputIndex: 4, sign: 'positive' },
    ],
  },
  {
    panL: [
      { padIndex: 0, type: 'axis', inputIndex: 2, sign: 'negative' },
    ],
    panR: [
      { padIndex: 0, type: 'axis', inputIndex: 2, sign: 'positive' },
    ],
    tiltU: [
      { padIndex: 0, type: 'axis', inputIndex: 3, sign: 'negative' },
    ],
    tiltD: [
      { padIndex: 0, type: 'axis', inputIndex: 3, sign: 'positive' },
    ],
    rollL: [],
    rollR: [],
    zoomI: [
      { padIndex: 0, type: 'button', inputIndex: 7, sign: 'positive' },
    ],
    zoomO: [
      { padIndex: 0, type: 'button', inputIndex: 5, sign: 'positive' },
    ],
  },
];

/**
 * @param {{
 *   groupIds: string[][],
 *   controlStates: ControlState[],
 *   setControlStates: function(ControlState[]): void,
 *   send: function(CommandMessage): void,
 *   mappings: Mapping[],
 * }} props
 */
function useGamepadPoll({ groupIds, setControlStates, send, mappings }) {
  const requestRef = useRef();
  const lastPoll = useRef(document.timeline.currentTime || 0);
  // Track the send times independently for each device group, so that we can send commands
  // immediately when they are non-zero
  const lastSends = useRef(/** @type {SendState[]} */([]));
  const lastStates = useRef(/** @type {ControlState[]} */([]));
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
    if (mouseControlRef.current.index != null) {
      controlStates[mouseControlRef.current.index] =
        mouseStateToControlState(mouseControlRef.current);
    }

    // Limit unnecessary re-renders by only updating state when the values change
    if (!allStatesEqual(lastStates.current, controlStates)) {
      setControlStates(controlStates);
    }
    lastStates.current = controlStates;

    groupIds.forEach((group, i) => {
      /** @type {ControlState} */
      const currState = controlStates[i] || ZERO_STATE;
      /** @type {Partial<SendState>} */
      const sendState = lastSends.current[i] || {};
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
          devices: group,
          ...currState,
        }
      });
      lastSends.current[i] = {
        lastTimestamp: currentTime,
        lastState: currState,
      };
    });
  }, [groupIds, setControlStates]);
  useEffect(() => {
    requestRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(requestRef.current);
  }, [poll, mappings]);
}

/**
 * @typedef {{
 *   index: number|null,
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
    index: null,
    type: 'pan-tilt',
    origin: [0, 0],
    currXY: [0, 0],
    range: 0,
  };
  const ref = useRef(initialVal);
  useEffect(() => {
    /**
     * @param {MouseEvent} e
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
      const allGroups = Array.from(document.querySelectorAll('.js-control'));
      const targetControl = target.closest('.js-control');
      if (targetControl == null) {
        return;
      }
      const index = allGroups.indexOf(targetControl);
      if (index === -1) {
        return;
      }
      /** @type {MouseControl} */
      const control = {
        index,
        type: target.matches('.js-zoom-joystick') ? 'zoom' : 'pan-tilt',
        origin: [e.clientX, e.clientY],
        currXY: [e.clientX, e.clientY],
        range: (target.parentElement?.clientHeight || 0) / 2,
      };
      Object.assign(ref.current, control);
    };
    /**
     * @param {MouseEvent} e
     */
    const move = function(e) {
      if (ref.current.index != null) {
        e.preventDefault();
        ref.current.currXY = [e.clientX, e.clientY];
      }
    };
    const endDrag = function() {
      ref.current.index = null;
    };
    document.documentElement.addEventListener('mousedown', startDrag);
    document.documentElement.addEventListener('mousemove', move);
    document.documentElement.addEventListener('mouseup', endDrag);
    document.documentElement.addEventListener('mouseleave', endDrag);
    return function cleanup() {
      document.documentElement.removeEventListener('mousedown', startDrag);
      document.documentElement.removeEventListener('mousemove', move);
      document.documentElement.removeEventListener('mouseup', endDrag);
      document.documentElement.removeEventListener('mouseleave', endDrag);
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
 *   state: DeviceGroupState,
 *   send: function(CommandMessage|DisconnectMessage|ReconnectMessage): void,
 * }}
 */
function useServer() {
  const [state, setState] = useState(/** @type {DeviceGroupState} */ ({
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
      /** @type {DeviceGroupState} */
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
  const [controlStates, setControlStates] = useState(/** @type {ControlState[]} */ (
    state.groups.map(() => ZERO_STATE)
  ));
  useGamepadPoll({
    groupIds: state.groups,
    controlStates,
    setControlStates,
    send,
    mappings: MAPPINGS,
  });
  const onDisconnect = (id) => {
    send({ disconnect: { devices: [id] } });
  };
  const onReconnect = (id) => {
    send({ reconnect: { devices: [id] } });
  };

  return state.groups.map((group, i) => {
    const s = controlStates[i] || ZERO_STATE;
    return html`
      <div class="control js-control"
        style=${{
          '--pan': s.pan,
          '--tilt': s.tilt,
          '--roll': s.roll,
          '--zoom': s.zoom,
        }}
      >
        <div>
          ${group.map((id) => {
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

function nonNull(x) {
  return x != null;
}

/**
 * @param {Mapping[]} mappings
 * @returns {ControlState[]}
 */
function readGamepads(mappings) {
  const pads = navigator.getGamepads().map(normalizeGamepad);
  return mappings.map(m => readMapping(pads, m));
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
 * @param {ControlState[]} states1
 * @param {ControlState[]} states2
 * @returns {boolean}
 */
function allStatesEqual(states1, states2) {
  return states1.length === states2.length && states1.every((state1, i) => statesEqual(state1, states2[i]));
}

/**
 * @param {ControlState} state1
 * @param {ControlState} state2
 * @returns {boolean}
 */
function statesEqual(state1, state2) {
  return state1.pan === state2.pan && state1.tilt === state2.tilt && state1.roll === state2.roll && state1.zoom === state2.zoom;
}

/**
 * @param {ControlState} state
 * @returns {boolean}
 */
function isZero(state) {
  return statesEqual(state, ZERO_STATE);
}
