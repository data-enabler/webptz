const POLLING_RATE = 200;
const DEADZONE = 0.1;

const websocket = new WebSocket("/control");
const visualizer = /** @type {HTMLElement} */ (document.querySelectorAll('.device__joystick')[0]);
const zoomSlider = /** @type {HTMLInputElement} */ (document.querySelectorAll('.device__zoom')[0]);
const disconnectButton = /** @type {HTMLButtonElement} */ (document.querySelectorAll('.device__disconnect')[0]);
const reconnectButton = /** @type {HTMLButtonElement} */ (document.querySelectorAll('.device__reconnect')[0]);

/**
 * @typedef {{
 *  devices: string[],
 *  pan: number,
 *  tilt: number,
 *  roll: number,
 *  zoom: number,
 * }} Data
 */

/** @type {Data} */
let lastData = {
  devices: [],
  pan: 0,
  tilt: 0,
  roll: 0,
  zoom: 0,
};

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

function pollGamepads() {
  const pad = navigator.getGamepads().filter(nonNull)[0];
  if (pad == null) {
    return;
  }

  pollGamepad(pad);
}

/**
 * @param {Gamepad} pad
 * @returns
 */
function pollGamepad(pad) {
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
  visualizer.style.left = `${pan * 50 + 50}%`;
  visualizer.style.bottom = `${tilt * 50 + 50}%`;
  zoomSlider.value = zoom;

  /** @type {Data} */
  const data = {
    devices: [],
    pan,
    tilt,
    roll,
    zoom,
  };
  if (isZero(data) && isZero(lastData)) {
    return;
  }
  console.log(data);
  websocket.send(JSON.stringify({ command: data }));
  lastData = data;
}

/**
 * @param {Data} data
 * @returns {boolean}
 */
function isZero(data) {
  return data.pan === 0 && data.tilt === 0 && data.roll === 0 && data.zoom === 0;
}

window.setInterval(pollGamepads, POLLING_RATE);
disconnectButton.addEventListener('click', () => {
  websocket.send(JSON.stringify({ disconnect: { devices: [] } }));
});
reconnectButton.addEventListener('click', () => {
  websocket.send(JSON.stringify({ reconnect: { devices: [] } }));
});
