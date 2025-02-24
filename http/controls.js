import { useEffect, useRef, useCallback } from 'htm/preact';

/** @import { GamepadData, Mapping, Mappings } from './mapping.js'; */
import { normalizeGamepad, readInputs } from './mapping.js';
import { useMouseControl, mouseStateToControlState } from './mouse.js';
/** @import { CommandMessage, Group } from './server.js'; */
/** @import { ControlState, ControlStates } from './state.js'; */
import { allStatesEqual, isZero, ZERO_STATE } from './state.js';

/**
 * @typedef {{
 *   lastTimestamp: number,
 *   lastState: ControlState,
 * }} SendState
 */

/**
 * @typedef {Record<string, SendState>} SendStates
 */

const EPSILON = 0.5 * 1 / 240; // Ideally this would be based on the display refresh rate

const POLL_INTERVAL = (1 / 60 - EPSILON) * 1000;
const SEND_INTERVAL = (1 / 5 - EPSILON) * 1000;

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

    // Limit polling rate to once every POLL_INTERVAL
    const currentTime = /** @type {number} */ (document.timeline.currentTime || 0);
    if (currentTime - lastPoll.current < POLL_INTERVAL) {
      return;
    }

    // Ignore inputs while modals are open
    if (document.querySelector('dialog[open]')) {
      return;
    }
    lastPoll.current = currentTime;
    const controlStates = readGamepads(mappings, lastStates.current);
    if (mouseControlRef.current.groupId != null) {
      controlStates[mouseControlRef.current.groupId] =
        mouseStateToControlState(mouseControlRef.current, lastStates.current[mouseControlRef.current.groupId]);
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
        lastTimestamp = 0, lastState = ZERO_STATE,
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
          autofocus: currState.autofocus.active || false,
        }
      });
      lastSends.current[groupId] = {
        lastTimestamp: currentTime,
        lastState: currState,
      };
      // Unset boolean values after sending
      if (lastStates.current[groupId].autofocus.active) {
        lastStates.current[groupId].autofocus.active = null;
      }
    });
  }, [groups, setControlStates, mappings]);
  useEffect(() => {
    requestRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(requestRef.current);
  }, [poll]);
}

/**
 * @param {Mappings} mappings
 * @param {ControlStates} prevStates
 * @returns {ControlStates}
 */
export function readGamepads(mappings, prevStates) {
  const pads = navigator.getGamepads().map(normalizeGamepad);
  return Object.fromEntries(
    Object.entries(mappings)
      .map(([groupId, m]) => [groupId, readMapping(pads, m, prevStates[groupId])])
  );
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {Mapping} mapping
 * @param {ControlState|undefined} prevState
 * @returns {ControlState}
 */
function readMapping(pads, mapping, prevState) {
  const pan = -1 * readInputs(pads, mapping.panL) + readInputs(pads, mapping.panR);
  const tilt = -1 * readInputs(pads, mapping.tiltD) + readInputs(pads, mapping.tiltU);
  const roll = -1 * readInputs(pads, mapping.rollL) + readInputs(pads, mapping.rollR);
  const zoom = -1 * readInputs(pads, mapping.zoomO) + readInputs(pads, mapping.zoomI);
  const focus = -1 * readInputs(pads, mapping.focusN) + readInputs(pads, mapping.focusF);
  const autofocusPressed = readInputs(pads, mapping.focusA) > 0;
  const autofocus = {
    pressed: autofocusPressed,
    active: prevState?.autofocus.active || (autofocusPressed && !prevState?.autofocus.pressed),
  };

  return {
    pan,
    tilt,
    roll,
    zoom,
    focus,
    autofocus,
  };
}
