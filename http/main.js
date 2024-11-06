const POLLING_RATE = 200;
const DEADZONE = 0.1;

const websocket = new WebSocket("/control");

const visualizer = document.querySelectorAll('.joystick__stick')[0];

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

  pollGamepad(pads[0], 0);
}

function pollGamepad(pad, cameraNum) {
  const pan = ignoreDeadzone(pad.axes[0]);
  const tilt = ignoreDeadzone(-1 * pad.axes[1]);
  visualizer.style.left = `${pan * 50 + 50}%`;
  visualizer.style.bottom = `${tilt * 50 + 50}%`;
  if (pan === 0 && tilt === 0) {
    return;
  }
  const data = {
    camera: cameraNum,
    pan,
    tilt,
    roll: 0,
  };
  console.log(data);
  websocket.send(JSON.stringify(data));
}

window.setInterval(pollGamepads, POLLING_RATE);

