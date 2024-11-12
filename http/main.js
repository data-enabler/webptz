const POLLING_RATE = 200;
const DEADZONE = 0.1;

const websocket = new WebSocket("/control");

const visualizer = /** @type {HTMLElement} */ (document.querySelectorAll('.joystick__stick')[0]);

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
  const pads = navigator.getGamepads().filter(nonNull);
  if (pads.length === 0) {
    return;
  }

  pollGamepad(pads[0]);
}

function pollGamepad(pad) {
  const axis_lx = 0;
  const axis_ly = 1;
  const axis_rx = 2;
  let axis_ry = 3;
  if (pad.id.includes('DualSense')) {
    axis_ry = 5;
  }
  const pan = ignoreDeadzone(pad.axes[axis_lx]) || ignoreDeadzone(pad.axes[axis_rx]);
  const tilt = ignoreDeadzone(-1 * pad.axes[axis_ly]) || ignoreDeadzone(-1 * pad.axes[axis_ry]);
  visualizer.style.left = `${pan * 50 + 50}%`;
  visualizer.style.bottom = `${tilt * 50 + 50}%`;
  if (pan === 0 && tilt === 0) {
    return;
  }
  const data = {
    devices: [],
    pan,
    tilt,
    roll: 0,
  };
  console.log(data);
  websocket.send(JSON.stringify(data));
}

window.setInterval(pollGamepads, POLLING_RATE);

