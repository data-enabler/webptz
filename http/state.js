/**
 * `active` is essentially a trinary value, but `null` is used since it's more
 * convenient to have two falsy values.
 *
 * @typedef {{
 *   pan: number,
 *   tilt: number,
 *   roll: number,
 *   zoom: number,
 *   focus: number,
 *   autofocus: {
 *     pressed: boolean,
 *     active: boolean|null,
 *   },
 * }} ControlState
 */

/** @type {ControlState} */
export const ZERO_STATE = Object.freeze({
  pan: 0,
  tilt: 0,
  roll: 0,
  zoom: 0,
  focus: 0,
  autofocus: {
    pressed: false,
    active: false,
  },
});

/**
 * @typedef {Record<string, ControlState>} ControlStates
 */

/**
 * @param {ControlStates} states1
 * @param {ControlStates} states2
 * @returns {boolean}
 */
export function allStatesEqual(states1, states2) {
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
export function statesEqual(state1, state2) {
  if (state1 == null || state2 == null) {
    return state1 == state2;
  }
  return state1.pan === state2.pan &&
    state1.tilt === state2.tilt &&
    state1.roll === state2.roll &&
    state1.zoom === state2.zoom &&
    state1.focus === state2.focus &&
    state1.autofocus.pressed === state2.autofocus.pressed &&
    state1.autofocus.active === state2.autofocus.active;
}

/**
 * @param {ControlState} state
 * @returns {boolean}
 */
export function isZero(state) {
  return state.pan === 0 &&
    state.tilt === 0 &&
    state.roll === 0 &&
    state.zoom === 0 &&
    state.focus === 0 &&
    state.autofocus.active === false;
}
