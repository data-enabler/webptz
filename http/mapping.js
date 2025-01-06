/**
 * @typedef {Pick<Gamepad, "buttons"|"axes"|"index"|"id"|"mapping">} GamepadData
 */

/**
 * @typedef {{
 *   readonly padIndex: number,
 *   readonly type: "axis"|"button",
 *   readonly inputIndex: number,
 *   readonly multiplier: number,
 * }} PadInput
 */

/**
 * @typedef {{
 *   readonly panL: readonly PadInput[],
 *   readonly panR: readonly PadInput[],
 *   readonly tiltU: readonly PadInput[],
 *   readonly tiltD: readonly PadInput[],
 *   readonly rollL: readonly PadInput[],
 *   readonly rollR: readonly PadInput[],
 *   readonly zoomI: readonly PadInput[],
 *   readonly zoomO: readonly PadInput[],
 * }} Mapping
 */

/**
 * @typedef {Record<string, Mapping>} Mappings
 */

/** @type {Mapping} */
export const EMPTY_MAPPING = Object.freeze({
  panL: [],
  panR: [],
  tiltU: [],
  tiltD: [],
  rollL: [],
  rollR: [],
  zoomI: [],
  zoomO: [],
});
const DEADZONE = 0.1;

/**
 * @param {Gamepad|null} pad
 * @return {GamepadData|null}
 */
export function normalizeGamepad(pad) {
  if (pad == null) {
    return null;
  }
  // DualSense controllers don't have a standard mapping available
  if (pad.id.includes('DualSense')) {
    const {axes: origAxes, buttons: origButtons} = pad;

    // DualSense triggers are cursed; they have a value of 0.0 until you first
    // press them. Relying on the assumption that 0.0 is basically impossible
    // to get otherwise.
    const l2 = ((pad.axes[3] || -1) + 1) / 2;
    const r2 = ((pad.axes[4] || -1) + 1) / 2;

    // DualSense dpad is encoded using an axis.
    // -1 is up, +1 is up-right, and unpressed is 1.28571
    const dpadAxis = origAxes[9];
    const dpadL = (dpadAxis <  1.25 && dpadAxis >  0.25) ? 1 : 0;
    const dpadD = (dpadAxis <  0.5  && dpadAxis > -0.25) ? 1 : 0;
    const dpadR = (dpadAxis <  0.0  && dpadAxis > -0.75) ? 1 : 0;
    const dpadU = (dpadAxis < -0.5  || dpadAxis === 1) ? 1 : 0;

    const axes = [
      origAxes[0],
      origAxes[1],
      origAxes[2],
      origAxes[5],
    ];
    const buttons = [
      // face buttons
      origButtons[1],
      origButtons[2],
      origButtons[0],
      origButtons[3],

      // shoulder buttons
      origButtons[4],
      origButtons[5],
      { pressed: l2 > 0.1, touched: l2 > 0.1, value: l2 },
      { pressed: r2 > 0.1, touched: r2 > 0.1, value: r2 },

      // start, select
      origButtons[8],
      origButtons[9],

      // l3/r3
      origButtons[10],
      origButtons[11],

      // dpad
      { pressed: !!dpadU, touched: !!dpadU, value: dpadU },
      { pressed: !!dpadD, touched: !!dpadD, value: dpadD },
      { pressed: !!dpadL, touched: !!dpadL, value: dpadL },
      { pressed: !!dpadR, touched: !!dpadR, value: dpadR },

      // home, touchpad
      origButtons[12],
      origButtons[13],

      // mute
      origButtons[14],
    ];

    return {
      axes,
      buttons,
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
    };
  }
  return pad;
}

/**
 * Returns the first pressed input
 * @param {(GamepadData|null)[]} pads
 * @param {readonly PadInput[]} inputs
 * @returns {number}
 */
export function readInputs(pads, inputs) {
  for (const input of inputs) {
    const val = readInput(pads, input);
    if (val !== 0) {
      return val;
    }
  }
  return 0;
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {PadInput} input
 * @returns {number}
 */
export function readInput(pads, input) {
  const pad = pads[input.padIndex];
  if (pad == null) {
    return 0;
  }
  switch (input.type) {
    case 'button':
      return ignoreDeadzone(Math.max(0, pad.buttons[input.inputIndex].value * input.multiplier));
    case 'axis':
      return ignoreDeadzone(Math.max(0, pad.axes[input.inputIndex] * input.multiplier));
  }
}

/**
 * @param {number} val
 * @returns {number}
 */
function ignoreDeadzone(val) {
  if (Math.abs(val) < DEADZONE) {
    return 0;
  }
  return val;
}

/**
 * @param {function(PadInput): void} callback
 * @returns {function(): void} a cancel/cleanup function
 */
export function waitForGamepadInput(callback) {
  function findPressedInput() {
    for (const gamepad of navigator.getGamepads()) {
      const pad = normalizeGamepad(gamepad);
      if (pad == null) {
        continue;
      }
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i].pressed) {
          callback({
            padIndex: pad.index,
            type: 'button',
            inputIndex: i,
            multiplier: 1.0,
          });
          return;
        }
      }
      for (let i = 0; i < pad.axes.length; i++) {
        if (Math.abs(pad.axes[i]) > 0.25) {
          callback({
            padIndex: pad.index,
            type: 'axis',
            inputIndex: i,
            multiplier: pad.axes[i] > 0 ? 1.0 : -1.0,
          });
          return;
        }
      }
    }
  }
  const interval = setInterval(findPressedInput, 100);

  return function cleanup() {
    clearInterval(interval);
  };
}

/** @type {PadInput} */
const EXAMPLE_PADINPUT = Object.freeze({
  padIndex: 0,
  type: 'axis',
  inputIndex: 0,
  multiplier: 1.0,
});
const SORTED_MAPPINGS_KEYS = [
  ...Object.keys(EMPTY_MAPPING),
  ...Object.keys(EXAMPLE_PADINPUT),
];
/**
 * @param {Mappings} a
 * @param {Mappings} b
 * @returns {boolean}
 */
export function areMappingsEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const keys = Object.keys(a).concat(SORTED_MAPPINGS_KEYS).sort();
  return JSON.stringify(a, keys) === JSON.stringify(b, keys);
}

/**
 * @param {PadInput} a
 * @param {PadInput} b
 * @returns {boolean}
 */
export function arePadInputsEqual(a, b) {
  return JSON.stringify(a, SORTED_MAPPINGS_KEYS) === JSON.stringify(b, SORTED_MAPPINGS_KEYS);
}
