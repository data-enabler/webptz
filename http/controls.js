import { useEffect, useRef, useCallback } from 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js';

import { GamepadData, Mapping, Mappings, normalizeGamepad, readInputs } from './mapping.js';
import { useMouseControl, mouseStateToControlState } from './mouse.js';
import { CommandMessage, Group } from './server.js';
import { ControlState, ControlStates } from './state.js';

/**
 * @typedef {{
 *   lastTimestamp: number,
 *   lastState: ControlState,
 * }}
 */

export let SendState;
/**
 * @typedef {Record<string, SendState>}
 */

export let SendStates;
const EPSILON = 0.5 * 1 / 240; // Ideally this would be based on the display refresh rate

const POLL_INTERVAL = (1 / 60 - EPSILON) * 1000;
const SEND_INTERVAL = (1 / 5 - EPSILON) * 1000;
export const ZERO_STATE = Object.freeze({
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
export function useGamepadPoll({ groups, setControlStates, send, mappings }) {
  const requestRef = useRef(0);
  const lastPoll = useRef(/** @type {number} */ (document.timeline.currentTime || 0));
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
    const currentTime = /** @type {number} */ (document.timeline.currentTime || 0);
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

    groups.forEach(({ name: groupId, devices }) => {
      /** @type {ControlState} */
      const currState = controlStates[groupId] || ZERO_STATE;
      /** @type {Partial<SendState>} */
      const sendState = lastSends.current[groupId] || {};
      const {
        lastTimestamp = 0, lastState = { pan: 0, tilt: 0, roll: 0, zoom: 0 },
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
 * @param {Mappings} mappings
 * @returns {ControlStates}
 */
export function readGamepads(mappings) {
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
export function mapDefaultControls(groups, defaultControls) {
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
export function isZero(state) {
  return statesEqual(state, ZERO_STATE);
}
