import { useEffect, useRef } from 'htm/preact';

/** @import { ControlState } from './state.js'; */

/**
 * @typedef {{
 *   groupId: string|null,
 *   type: 'pan-tilt'|'zoom',
 *   origin: number[],
 *   currXY: number[],
 *   range: number,
 * }} MouseControl
 */

/**
 * @returns {{
 *   current: MouseControl,
 * }}
 */
export function useMouseControl() {
  /** @type {MouseControl} */
  const initialVal = {
    groupId: null,
    type: 'pan-tilt',
    origin: [0, 0],
    currXY: [0, 0],
    range: 0,
  };
  /** @type {{current: MouseControl}} */
  const ref = useRef(initialVal);
  useEffect(() => {
    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const startDrag = function (e) {
      if (e.target == null) {
        return;
      }
      const target = /** @type {HTMLElement} */ (e.target);
      if (!target.matches('.js-pt-joystick, .js-zoom-joystick')) {
        return;
      }
      e.preventDefault();
      const targetControl = /** @type {HTMLElement|null} */ (target.closest('.js-control'));
      const groupId = targetControl?.dataset.groupId;
      if (!groupId) {
        return;
      }
      const origin = e instanceof MouseEvent
        ? [e.clientX, e.clientY]
        : [e.touches[0].clientX, e.touches[0].clientY];
      /** @type {MouseControl} */
      const control = {
        groupId,
        type: target.matches('.js-zoom-joystick') ? 'zoom' : 'pan-tilt',
        origin,
        currXY: origin,
        range: (target.parentElement?.clientHeight || 0) / 2,
      };
      Object.assign(ref.current, control);
    };
    /**
     * @param {MouseEvent|TouchEvent} e
     */
    const move = function (e) {
      if (ref.current.groupId != null) {
        e.preventDefault();
        ref.current.currXY = e instanceof MouseEvent
          ? [e.clientX, e.clientY]
          : [e.touches[0].clientX, e.touches[0].clientY];
      }
    };
    const endDrag = function () {
      ref.current.groupId = null;
    };
    document.documentElement.addEventListener('mousedown', startDrag);
    document.documentElement.addEventListener('touchstart', startDrag, { passive: false });
    document.documentElement.addEventListener('mousemove', move);
    document.documentElement.addEventListener('touchmove', move, { passive: false });
    document.documentElement.addEventListener('mouseup', endDrag);
    document.documentElement.addEventListener('touchend', endDrag);
    document.documentElement.addEventListener('mouseleave', endDrag);
    document.documentElement.addEventListener('touchcancel', endDrag);
    return function cleanup() {
      document.documentElement.removeEventListener('mousedown', startDrag);
      document.documentElement.removeEventListener('touchstart', startDrag);
      document.documentElement.removeEventListener('mousemove', move);
      document.documentElement.removeEventListener('touchmove', move);
      document.documentElement.removeEventListener('mouseup', endDrag);
      document.documentElement.removeEventListener('touchend', endDrag);
      document.documentElement.removeEventListener('mouseleave', endDrag);
      document.documentElement.removeEventListener('touchcancel', endDrag);
    };
  }, []);
  return ref;
}
/**
 * @param {MouseControl} c
 * @return {ControlState}
 */
export function mouseStateToControlState(c) {
  if (c.range === 0) {
    return {
      pan: 0,
      tilt: 0,
      roll: 0,
      zoom: 0,
    };
  }
  let pan = 0;
  let tilt = 0;
  let zoom = 0;
  if (c.type === 'pan-tilt') {
    const deltaX = c.currXY[0] - c.origin[0];
    const deltaY = -1 * (c.currXY[1] - c.origin[1]);
    const angle = Math.atan2(deltaY, deltaX);
    const unclamped = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / c.range;
    const magnitude = Math.min(Math.max(unclamped, -1), 1);
    pan = magnitude * Math.cos(angle);
    tilt = magnitude * Math.sin(angle);
  }
  if (c.type === 'zoom') {
    const unclamped = -1 * (c.currXY[1] - c.origin[1]) / c.range;
    zoom = Math.min(Math.max(unclamped, -1), 1);
  }
  return {
    pan,
    tilt,
    roll: 0,
    zoom,
  };
}
