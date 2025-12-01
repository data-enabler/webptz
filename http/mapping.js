/**
 * @typedef {Pick<Gamepad, "buttons"|"axes"|"index"|"id"|"mapping">} GamepadData
 */

/**
 * @typedef {{
 *   readonly padIndex: number,
 *   readonly type: "axis"|"button",
 *   readonly inputIndex: number,
 *   readonly multiplier: number,
 * }} UnmodifiedInput
 */

/**
 * @typedef {{
 *   readonly padIndex: number,
 *   readonly type: "axis"|"button",
 *   readonly inputIndex: number,
 *   readonly multiplier: number,
 *   readonly modifiers?: UnmodifiedInput[],
 * }} PadInput
 */

/**
 * @typedef {{
 *   readonly panL?: readonly PadInput[],
 *   readonly panR?: readonly PadInput[],
 *   readonly tiltU?: readonly PadInput[],
 *   readonly tiltD?: readonly PadInput[],
 *   readonly rollL?: readonly PadInput[],
 *   readonly rollR?: readonly PadInput[],
 *   readonly zoomI?: readonly PadInput[],
 *   readonly zoomO?: readonly PadInput[],
 *   readonly focusF?: readonly PadInput[],
 *   readonly focusN?: readonly PadInput[],
 *   readonly focusA?: readonly PadInput[],
 * }} Mapping
 */

/**
 * @typedef {Record<string, Mapping|undefined>} Mappings
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
  focusF: [],
  focusN: [],
  focusA: [],
});
const DEADZONE = 0.1;
const PRESSED_THRESHOLD = 0.75;

/**
 * @param {Gamepad|null} pad
 * @return {GamepadData|null}
 */
export function normalizeGamepad(pad) {
  if (pad == null) {
    return null;
  }
  // DualSense controllers don't have a standard mapping available in all browsers
  if (pad.id.includes('DualSense') && pad.mapping != 'standard') {
    const {axes: origAxes, buttons: origButtons} = pad;

    const l2 = axisToButtonValue(pad.axes[3]);
    const r2 = axisToButtonValue(pad.axes[4]);

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
      valueToButton(l2),
      valueToButton(r2),

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

    return ({
      axes,
      buttons,
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
    });
  }

  // The standard mapping only has 4 axes, but some browser/gamepad combinations
  // (e.g. DS4 on Firefox) present additional axes containing analog values for
  // the triggers
  if (pad.mapping === 'standard' && pad.axes.length === 6) {
    const buttons = pad.buttons.slice();
    const l2 = axisToButtonValue(pad.axes[4]);
    const r2 = axisToButtonValue(pad.axes[5]);
    buttons[6] = valueToButton(l2);
    buttons[7] = valueToButton(r2);
    return ({
      axes: pad.axes.slice(0, 4),
      buttons: buttons,
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
    });
  }

  return ({
    axes: pad.axes,
    buttons: pad.buttons,
    index: pad.index,
    id: pad.id,
    mapping: pad.mapping,
  });
}

/**
 * @param {number} axis 
 * @returns {number}
 */
function axisToButtonValue(axis) {
  // Trigger values on DS4/Dualsense are rather annoying; they have a value of
  // 0.0 until you first press them. Relying on the assumption that 0.0 is
  // basically impossible to get otherwise.
  return ((axis || -1) + 1) / 2;
}

/**
 * @param {number} l2 
 * @returns {GamepadButton}
 */
function valueToButton(l2) {
  return { pressed: l2 > 0.1, touched: l2 > 0.1, value: l2 };
}

/**
 * @param {PadInput} a 
 * @param {PadInput} b 
 * @returns {number}
 */
function byModifiersDecreasing(a, b) {
  return (b.modifiers?.length || 0) - (a.modifiers?.length || 0);
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {PadInput} input
 * @returns {{
 *   value: number,
 *   pressed: boolean,
 * }}
 */
export function readInput(pads, input) {
  const { value, pressed } = readUnmodifiedInput(pads, input);
  if (pressed  && input.modifiers?.length) {
    for (const m of input.modifiers) {
      if (!readUnmodifiedInput(pads, m).pressed) {
        return ({
          value: 0,
          pressed: false,
        });
      }
    }
  }
  return ({ value, pressed });
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {UnmodifiedInput} input
 * @returns {{
 *   value: number,
 *   pressed: boolean,
 * }}
 */
export function readUnmodifiedInput(pads, input) {
  const pad = pads[input.padIndex];
  if (pad == null) {
    return ({
      value: 0,
      pressed: false,
    });
  }

  const button = /** @type {GamepadButton|undefined} */(pad.buttons[input.inputIndex]);
  const axis = /** @type {number|undefined} */(pad.axes[input.inputIndex]);
  let rawValue = 0;
  switch (input.type) {
    case 'button':
      rawValue = ignoreDeadzone(button?.value ?? 0);
      return ({
        value: Math.max(0, rawValue * input.multiplier),
        pressed: rawValue !== 0,
      });
    case 'axis':
      rawValue = ignoreDeadzone(axis ?? 0);
      return ({
        value: Math.max(0, rawValue * input.multiplier),
        pressed: rawValue !== 0,
      });
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
  /** @type {Record<string, GamepadData>} */
  const previousPads = {};
  function findPressedInput() {
    for (const gamepad of navigator.getGamepads()) {
      const pad = normalizeGamepad(gamepad);
      if (pad == null) {
        continue;
      }

      const previousPad = previousPads[pad.id];
      previousPads[pad.id] = clonePad(pad);
      if (previousPad == null) {
        continue;
      }

      const releasedInput = findReleasedInput(previousPad, pad);
      if (!releasedInput) {
        continue;
      }

      const heldInputs = findHeldInputs(pad);
      callback({
        ...releasedInput,
        modifiers: heldInputs.length ? heldInputs : undefined,
      });
    }
  }
  const interval = setInterval(findPressedInput, 100);

  return function cleanup() {
    clearInterval(interval);
  };
}

/**
 * @param {GamepadData} oldPad 
 * @param {GamepadData} newPad 
 * @returns {UnmodifiedInput | null}
 */
function findReleasedInput(oldPad, newPad) {
  for (let i = 0; i < newPad.buttons.length; i++) {
    const wasPressed = oldPad.buttons[i].pressed && oldPad.buttons[i].value > PRESSED_THRESHOLD;
    const nowReleased = !newPad.buttons[i].pressed;
    if (wasPressed && nowReleased) {
      return ({
        padIndex: newPad.index,
        type: 'button',
        inputIndex: i,
        multiplier: 1.0,
      });
    }
  }
  for (let i = 0; i < newPad.axes.length; i++) {
    const wasPressed = Math.abs(oldPad.axes[i]) > PRESSED_THRESHOLD;
    const nowReleased = Math.abs(newPad.axes[i]) <= PRESSED_THRESHOLD;
    if (wasPressed && nowReleased) {
      return ({
        padIndex: newPad.index,
        type: 'axis',
        inputIndex: i,
        multiplier: newPad.axes[i] > 0 ? 1.0 : -1.0,
      });
    }
  }
  return null;
}

/**
 * @param {GamepadData} pad 
 * @returns {UnmodifiedInput[]}
 */
function findHeldInputs(pad) {
  /** @type {UnmodifiedInput[]} */
  const inputs = [];
  for (let i = 0; i < pad.buttons.length; i++) {
    if (pad.buttons[i].pressed && pad.buttons[i].value > 0.75) {
      inputs.push({
        padIndex: pad.index,
        type: 'button',
        inputIndex: i,
        multiplier: 1.0,
      });
    }
  }
  for (let i = 0; i < pad.axes.length; i++) {
    if (Math.abs(pad.axes[i]) > 0.75) {
      inputs.push({
        padIndex: pad.index,
        type: 'axis',
        inputIndex: i,
        multiplier: pad.axes[i] > 0 ? 1.0 : -1.0,
      });
    }
  }
  return inputs;
}

/** @type {PadInput} */
const EXAMPLE_PADINPUT = Object.freeze({
  padIndex: 0,
  type: 'axis',
  inputIndex: 0,
  multiplier: 1.0,
  modifiers: [],
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

/**
 * @param {GamepadData} pad 
 * @returns {GamepadData}
 */
function clonePad(pad) {
  return ({
    id: pad.id,
    index: pad.index,
    mapping: pad.mapping,
    axes: pad.axes.slice(),
    buttons: pad.buttons.map(b => ({
      pressed: b.pressed,
      value: b.value,
      touched: b.touched,
    })),
  });
}

