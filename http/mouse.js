import { useEffect, useRef } from 'htm/preact';

/** @import { ControlState, ControlStates } from './state.js'; */
import { ZERO_STATE } from './state.js';

/**
 * @typedef {{
 *   touchId: number|null,
 *   origin: number[],
 *   currXY: number[],
 *   range: number,
 * }} JoystickControl
 */

/**
 * @typedef {{
 *   joysticks: {
 *     panTilt: JoystickControl;
 *     zoom: JoystickControl;
 *     focus: JoystickControl;
 *   };
 *   buttons: {
 *     autofocus: boolean;
 *   };
 * }} MouseControl
 */

/**
 * @typedef {Record<string, MouseControl>} MouseControls
 */

/**
 * @typedef {{
 *   target: EventTarget,
 *   identifier: number,
 *   clientX: number,
 *   clientY: number,
 * }} PointerEvent
 */

const MOUSE_IDENTIFIER = -1;

/**
 * @returns {{
 *   current: MouseControls,
 * }}
 */
export function useMouseControl() {
  /** @type {{current: MouseControls}} */
  const ref = useRef({});
  useEffect(() => {
    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const startDrag = function (e) {
      const pointerEvents = e instanceof MouseEvent ? [{
        identifier: MOUSE_IDENTIFIER,
        target: e.target,
        clientX: e.clientX,
        clientY: e.clientY,
      }] : e.changedTouches;

      for (const touch of pointerEvents) {
        const target = /** @type {HTMLElement} */ (touch.target);
        if (!target.matches('.js-joystick')) {
          continue;
        }
        e.preventDefault();
        const groupId = target.dataset.groupId;
        const type = /** @type {(keyof MouseControl['joysticks'])|undefined} */(target.dataset.type);
        if (!groupId || !type) {
          return;
        }

        const currXY = [touch.clientX, touch.clientY];
        const joystick = getJoystick(ref, groupId, type);
        // If the joystick is already being dragged, try to keep the original
        // origin so that the joystick doesn't snap back to the center
        const prevXOffset = -1 * joystick.currXY[0] + joystick.origin[0];
        const prevYOffset = -1 * joystick.currXY[1] + joystick.origin[1];
        const joystickDims = target.getBoundingClientRect();
        const joystickSize = Math.max(joystickDims.width, joystickDims.height);
        const containerDims = target.parentElement
          ? target.parentElement.getBoundingClientRect()
          : { width: 0, height: 0 };
        const containerSize = Math.max(containerDims.width, containerDims.height);
        joystick.touchId = touch.identifier;
        joystick.origin = [currXY[0] + prevXOffset, currXY[1] + prevYOffset];
        joystick.currXY = currXY;
        joystick.range = (containerSize - joystickSize) / 2;
      }
    };

    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const moveDrag = function (e) {
      const pointerEvents = e instanceof MouseEvent ? [{
        identifier: MOUSE_IDENTIFIER,
        target: e.target,
        clientX: e.clientX,
        clientY: e.clientY,
      }] : e.changedTouches;

      for (const touch of pointerEvents) {
        const joystick = getJoystickByTouchId(ref, touch.identifier);
        if (joystick == null) {
          continue;
        }
        e.preventDefault();
        joystick.currXY = [touch.clientX, touch.clientY];
      }
    };

    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const endDrag = function (e) {
      const pointerEvents = e instanceof MouseEvent ? [{
        identifier: MOUSE_IDENTIFIER,
        target: e.target,
        clientX: e.clientX,
        clientY: e.clientY,
      }] : e.changedTouches;

      for (const touch of pointerEvents) {
        const joystick = getJoystickByTouchId(ref, touch.identifier);
        if (joystick == null) {
          continue;
        }
        e.preventDefault();
        joystick.touchId = null;
        joystick.origin = [0, 0];
        joystick.currXY = [0, 0];
        joystick.range = 0;
      }
    };

    /**
     * @param {MouseEvent} e
     */
    const onClick = function (e) {
      const target = /** @type {HTMLElement} */ (e.target);
      if (!target.matches('.js-button')) {
        return;
      }
      const groupId = target.dataset.groupId;
      const type = /** @type {(keyof MouseControl['buttons'])|undefined} */(target.dataset.type);
      if (!groupId || !type) {
        return;
      }
      console.log(groupId, type);
      const buttons = getButtons(ref, groupId);
      // Consider button pressed for enough time to guarantee a poll
      buttons[type] = true;
      setTimeout(() => {
        buttons[type] = false;
      }, 100);
    };

    document.documentElement.addEventListener('mousedown', startDrag);
    document.documentElement.addEventListener('touchstart', startDrag, { passive: false });
    document.documentElement.addEventListener('mousemove', moveDrag);
    document.documentElement.addEventListener('touchmove', moveDrag, { passive: false });
    document.documentElement.addEventListener('mouseup', endDrag);
    document.documentElement.addEventListener('touchend', endDrag);
    document.documentElement.addEventListener('mouseleave', endDrag);
    document.documentElement.addEventListener('touchcancel', endDrag);
    document.documentElement.addEventListener('click', onClick);
    return function cleanup() {
      document.documentElement.removeEventListener('mousedown', startDrag);
      document.documentElement.removeEventListener('touchstart', startDrag);
      document.documentElement.removeEventListener('mousemove', moveDrag);
      document.documentElement.removeEventListener('touchmove', moveDrag);
      document.documentElement.removeEventListener('mouseup', endDrag);
      document.documentElement.removeEventListener('touchend', endDrag);
      document.documentElement.removeEventListener('mouseleave', endDrag);
      document.documentElement.removeEventListener('touchcancel', endDrag);
      document.documentElement.removeEventListener('click', onClick);
    };
  }, []);
  return ref;
}

/**
 * @param {{ current: MouseControls }} ref
 * @param {number} identifier
 * @returns {JoystickControl|null}
 */
function getJoystickByTouchId(ref, identifier) {
  for (const [_, control] of Object.entries(ref.current)) {
    for (const [_, joystick] of Object.entries(control.joysticks)) {
      if (joystick.touchId === identifier) {
        return joystick;
      }
    }
  }
  return null;
}

/**
 * @param {{ current: MouseControls }} ref
 * @param {string} groupId
 * @param {keyof MouseControl['joysticks']} type
 * @returns {JoystickControl}
 */
function getJoystick(ref, groupId, type) {
  ref.current[groupId] = ref.current[groupId] || newMouseControl();
  const joystick = ref.current[groupId].joysticks[type];
  return joystick;
}

/**
 * @param {{ current: MouseControls }} ref
 * @param {string} groupId
 * @returns {MouseControl['buttons']}
 */
function getButtons(ref, groupId) {
  ref.current[groupId] = ref.current[groupId] || newMouseControl();
  return ref.current[groupId].buttons;
}

/**
 * @returns {MouseControl}
 */
function newMouseControl() {
  return {
    joysticks: {
      panTilt: { touchId: null, origin: [0, 0], currXY: [0, 0], range: 0 },
      zoom: { touchId: null, origin: [0, 0], currXY: [0, 0], range: 0 },
      focus: { touchId: null, origin: [0, 0], currXY: [0, 0], range: 0 },
    },
    buttons: {
      autofocus: false,
    },
  };
}

/**
 * @param {MouseControls} c
 * @param {ControlStates} prevStates
 * @return {ControlStates}
 */
export function mouseControlsToControlStates(c, prevStates) {
  /** @type {ControlStates} */
  const states = {};
  for (const [groupId, control] of Object.entries(c)) {
    const lastState = prevStates[groupId] || ZERO_STATE;
    const newState = mouseControlToControlState(control, lastState);
    states[groupId] = newState;
  }
  return states;
}

/**
 * @param {MouseControl} c
 * @param {ControlState} prevState
 * @return {ControlState}
 */
export function mouseControlToControlState(c, prevState) {
  const [pan, tilt] = getAxes(c.joysticks.panTilt);
  const zoom = getAxis(c.joysticks.zoom);
  const focus = getAxis(c.joysticks.focus);
  const autofocus = {
    pressed: c.buttons.autofocus,
    active: prevState.autofocus.active || (c.buttons.autofocus && !prevState.autofocus.pressed),
  };
  return {
    pan,
    tilt,
    roll: 0,
    zoom,
    focus,
    autofocus,
  };
}

/**
 * @param {JoystickControl} j
 * @returns {number}
 */
function getAxis(j) {
  if (j.range === 0) {
    return 0
  }
  const unclamped = -1 * (j.currXY[1] - j.origin[1]) / j.range;
  const y = Math.min(Math.max(unclamped, -1), 1);
  return y;
}

/**
 * @param {JoystickControl} j
 * @returns {[number, number]}
 */
function getAxes(j) {
  if (j.range === 0) {
    return [0, 0];
  }
  const deltaX = j.currXY[0] - j.origin[0];
  const deltaY = -1 * (j.currXY[1] - j.origin[1]);
  const angle = Math.atan2(deltaY, deltaX);
  const unclamped = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / j.range;
  const magnitude = Math.min(Math.max(unclamped, -1), 1);
  const x = magnitude * Math.cos(angle);
  const y = magnitude * Math.sin(angle);
  return [x, y];
}
