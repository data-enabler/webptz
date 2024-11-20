// @ts-ignore
import { html, render, useState, useEffect, useRef, useCallback } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';
// @ts-ignore
import ReconnectingWebSocket from 'https://unpkg.com/reconnecting-websocket@^4.4.0/dist/reconnecting-websocket-mjs.js';

const DEADZONE = 0.1;
const EPSILON = 0.5 * 1/240; // Ideally this would be based on the display refresh rate
const POLL_INTERVAL = (1/60 - EPSILON) * 1000;
const SEND_INTERVAL = (1/5 - EPSILON) * 1000;

const websocket = new ReconnectingWebSocket("/control", [], {
  minReconnectionDelay: 500,
  maxReconnectionDelay: 8000,
  reconnectionDelayGrowFactor: 2,
  maxEnqueuedMessages: 0,
});
/**
 * @param {Data} data
 */
function sendCommand(data) {
  console.log('Sending command', data);
  websocket.send(JSON.stringify({ command: data }));
}

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
 *   devices: {
 *     id: string,
 *     name: string,
 *   }[],
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

/**
 * @param {{
 *   groupIds: string[][],
 *   setControlStates: function(ControlState[]): void,
 * }} props
 */
function useGamepadPoll({ groupIds, setControlStates }) {
  const requestRef = useRef();
  const lastPoll = useRef(document.timeline.currentTime || 0);
  const lastSends = useRef(/** @type {SendState[]} */([]));
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
    const controlStates = readGamepads();
    setControlStates(controlStates);
    groupIds.forEach((group, i) => {
      const currState = controlStates[i];
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
      sendCommand({
        devices: group,
        ...currState,
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
  }, [poll]);
}

function App() {
  const groups = [
    {
      devices: [
        {
          id: 'ronin1',
          name: 'DJI RSC 2-080NH8',
        },
        {
          id: 'lumix1',
          name: 'BGH1-LP3',
        },
      ],
    },
  ];
  const groupIds = [['ronin1', 'lumix1']];
  const onDisconnect = (id) => {
    websocket.send(JSON.stringify({ disconnect: { devices: [id] } }));
  };
  const onReconnect = (id) => {
    websocket.send(JSON.stringify({ reconnect: { devices: [id] } }));
  };
  const [controlStates, setControlStates] = useState(/** @type {ControlState[]} */ (
    groups.map(() => ({
      pan: 0,
      tilt: 0,
      roll: 0,
      zoom: 0,
    }))
  ));
  useGamepadPoll({ groupIds, setControlStates });

  return controlStates.map((s, i) => html`
    <div class="control"
      style=${{
        '--pan': s.pan,
        '--tilt': s.tilt,
        '--roll': s.roll,
      }}
    >
      <div>
        ${groups[i].devices.map((d) => html`
          <div class="control__device">
            ${d.name}
            ${' '}
            <button onClick=${() => onDisconnect(d.id)}>Disconnect</button>
            <button onClick=${() => onReconnect(d.id)}>Reconnect</button>
          </div>
        `)}
      </div>
      <div class="control__frame">
        <div class="control__joystick"></div>
      </div>
      <input type="range" class="control__zoom" min="-1" max="1" step="0.01" value=${s.zoom} />
    </div>
  `);
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

function ignoreDeadzone(val) {
  if (Math.abs(val) < DEADZONE) {
    return 0;
  }
  return val;
}

/**
 * @returns {ControlState[]}
 */
function readGamepads() {
  const pad = navigator.getGamepads().filter(nonNull)[0];
  if (pad == null) {
    return [
      {
        pan: 0,
        tilt: 0,
        roll: 0,
        zoom: 0,
      },
    ];
  }

  return [readGamepad(pad)];
}

/**
 * @param {Gamepad} pad
 * @returns {ControlState}
 */
function readGamepad(pad) {
  const pan1 = ignoreDeadzone(pad.axes[0]);
  const tilt1 = ignoreDeadzone(-1 * pad.axes[1]);
  let zoom1 = ignoreDeadzone(pad.buttons[6].value - pad.buttons[4].value);
  const pan2 =  ignoreDeadzone(pad.axes[2]);
  let tilt2 = ignoreDeadzone(-1 * pad.axes[3]);
  let zoom2 = ignoreDeadzone(pad.buttons[7].value - pad.buttons[5].value);

  // Doesn't have a standard mapping
  if (pad.id.includes('DualSense')) {
    tilt2 = ignoreDeadzone(-1 * pad.axes[5]);

    // DualSense triggers are cursed; they have a value of 0.0 until you first
    // press them. Relying on the assumption that 0.0 is basically impossible
    // to get otherwise.
    const axis3 = pad.axes[3] || -1;
    const axis4 = pad.axes[4] || -1;
    zoom1 = ignoreDeadzone((axis3 + 1) / 2 - pad.buttons[4].value);
    zoom2 = ignoreDeadzone((axis4 + 1) / 2 - pad.buttons[5].value);
  }

  const pan = pan1 || pan2;
  const tilt = tilt1 || tilt2;
  const roll = 0;
  const zoom = zoom1 || zoom2;

  return {
    pan,
    tilt,
    roll,
    zoom,
  };
}

/**
 * @param {ControlState} state
 * @returns {boolean}
 */
function isZero(state) {
  return state.pan === 0 && state.tilt === 0 && state.roll === 0 && state.zoom === 0;
}
