import { useEffect, useRef, useCallback } from 'htm/preact';

/** @import { GamepadData, Mapping, Mappings, PadInput } from './mapping.js'; */
import { normalizeGamepad, readInput } from './mapping.js';
import { useMouseControl, mouseControlsToControlStates } from './mouse.js';
/** @import { CommandMessage, Group } from './server.js'; */
/** @import { ControlState, ControlStates } from './state.js'; */
import { allStatesEqual, isZero, mergeStates, ZERO_STATE } from './state.js';

/**
 * @typedef {{
 *   lastTimestamp: number,
 *   lastState: ControlState,
 * }} SendState
 */

/**
 * @typedef {Record<string, SendState>} SendStates
 */

/**
 * @typedef {{
 *   controlName: keyof Mapping,
 *   input: PadInput,
 *   baseInput: string,
 *   numModifiers: number,
 *   skip: boolean,
 * }} AnnotatedInput
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
    const controlStates = mergeStates(
      readGamepads(mappings, lastStates.current),
      mouseControlsToControlStates(mouseControlRef.current, lastStates.current),
    );

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
      .map(([groupId, m]) => [groupId, readMapping(pads, m || {}, prevStates[groupId])])
  );
}

/**
 * @param {(GamepadData|null)[]} pads
 * @param {Mapping} mapping
 * @param {ControlState|undefined} prevState
 * @returns {ControlState}
 */
function readMapping(pads, mapping, prevState) {
  const mappedInputs = /** @type {(keyof Mapping)[]} */(Object.keys(mapping))
    .flatMap(name => annotateInputs(name, mapping[name] || []))
    .sort(byNumModifiersDecreasing);

  let pan = 0;
  let tilt = 0;
  let roll = 0;
  let zoom = 0;
  let focus = 0;
  let autofocus = 0;
  for (const i of mappedInputs) {
    if (i.skip) {
      continue;
    }
    const { value, pressed } = readInput(pads, i.input);
    switch(i.controlName) {
      case 'panL':
        pan += -1 * value;
        break;
      case 'panR':
        pan += value;
        break;
      case 'tiltD':
        tilt += -1 * value;
        break;
      case 'tiltU':
        tilt += value;
        break;
      case 'rollL':
        roll += -1 * value;
        break;
      case 'rollR':
        roll += value;
        break;
      case 'zoomO':
        zoom += -1 * value;
        break;
      case 'zoomI':
        zoom += value;
        break;
      case 'focusN':
        focus += -1 * value;
        break;
      case 'focusF':
        focus += value;
        break;
      case 'focusA':
        autofocus += value;
        break;
    }
    if (pressed) {
      for (const ii of mappedInputs) {
        if (ii.baseInput === i.baseInput &&
          ii.numModifiers < i.numModifiers)
        {
          ii.skip = true;
        }
      }
    }
  }

  const autofocusPressed = autofocus > 0;
  const autofocusState = {
    pressed: autofocusPressed,
    active: prevState?.autofocus.active || (autofocusPressed && !prevState?.autofocus.pressed),
  };

  return {
    pan,
    tilt,
    roll,
    zoom,
    focus,
    autofocus: autofocusState,
  };
}

/**
 * @param {keyof Mapping} controlName 
 * @param {readonly PadInput[]} inputs 
 * @returns {AnnotatedInput[]}
 */
function annotateInputs(controlName, inputs) {
  return inputs.map(i => ({
    input: i,
    controlName,
    baseInput: inputIdentifier(i),
    numModifiers: i.modifiers?.length || 0,
    skip: false,
  }));
}

/**
 * @param {PadInput} i 
 * @returns {string}
 */
function inputIdentifier(i) {
  return `${i.padIndex}_${i.type}${i.inputIndex}`;
}

/**
 * @param {AnnotatedInput} a 
 * @param {AnnotatedInput} b 
 * @returns {number}
 */
function byNumModifiersDecreasing(a, b) {
  return b.numModifiers - a.numModifiers;
}

