import { html, render, useState, useEffect } from 'htm/preact';

import { ButtonMapper } from './button-mapper.js';
import { useGamepadPoll } from './controls.js';
/** @import { Mappings } from './mapping.js'; */
import { areMappingsEqual } from './mapping.js';
import { unmapDefaultControls, useServer } from './server.js';
/** @import { ControlStates } from './state.js'; */
import { ZERO_STATE } from './state.js';

function App() {
  const { state, send } = useServer();
  const [controlStates, setControlStates] = useState(/** @type {ControlStates} */ (
    Object.fromEntries(state.groups.map((g) => [g.name, ZERO_STATE]))
  ));
  const [localMappings, setLocalMappings] = useState(/** @type {Mappings|null} */(null));
  useEffect(() => {
    if (
      localMappings &&
        state.defaultControls &&
        areMappingsEqual(localMappings, state.defaultControls)
    ) {
      setLocalMappings(null);
    }
  }, [localMappings, setLocalMappings, state.defaultControls])
  const mappings = localMappings || state.defaultControls || {};
  useGamepadPoll({
    groups: state.groups,
    controlStates,
    setControlStates,
    send,
    mappings,
  });
  /**
   * @param {string} id
   */
  function onDisconnect(id) {
    send({ disconnect: { devices: [id] } });
  }
  /**
   * @param {string} id
   */
  function onReconnect(id) {
    send({ reconnect: { devices: [id] } });
  }

  /**
   * @param {Mappings} m
   */
  function setDefaultMappings(m) {
    send({ saveDefaultControls: unmapDefaultControls(state.groups, m) });
  }

  /** @type {Mappings} */
  const defaultMappings = state.defaultControls || {};
  const buttonMapper = html`
    <${ButtonMapper}
      groups=${state.groups}
      mappings=${mappings}
      setMappings=${setLocalMappings}
      defaultMappings=${defaultMappings}
      setDefaultMappings=${setDefaultMappings}
    />
  `;
  return state.groups.map(({ name: groupId, devices }) => {
    const s = controlStates[groupId] || ZERO_STATE;
    return html`
      <div class="control js-control"
        data-group-id=${groupId}
        style=${{
          '--pan': s.pan,
          '--tilt': s.tilt,
          '--roll': s.roll,
          '--zoom': s.zoom,
          '--focus': s.focus,
          '--autofocus': s.autofocus.pressed ? 1 : 0,
        }}
      >
        <header class="control__header">
          <h2 class="control__name">${groupId}</h2>
          ${buttonMapper}
        </header>
        <div>
          ${devices.map((id) => {
            const d = state.devices[id];
            return html`
              <div class="control__device">
                ${d.name}
                <br/>
                <button type="button" disabled=${!d.connected} onClick=${() => onDisconnect(d.id)}>Disconnect</button>
                ${' '}
                <button type="button" disabled=${d.connected} onClick=${() => onReconnect(d.id)}>Reconnect</button>
              </div>
            `;
          })}
        </div>
        <div class="control__controls">
          <div class="control__pt">
            <div class="control__pt-bg"></div>
            <div class="control__pt-joystick js-joystick" data-group-id=${groupId} data-type="panTilt"></div>
          </div>
          <div class="control__zoom">
            <div class="control__zoom-joystick js-joystick" data-group-id=${groupId} data-type="zoom"></div>
          </div>
          <div class="control__focus-container">
            <button type="button" class="control__focus-autofocus js-button" data-group-id=${groupId} data-type="autofocus" title="1-Shot Auto-Focus">AF</button>
            <div class="control__focus">
              <div class="control__focus-joystick js-joystick" data-group-id=${groupId} data-type="focus"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  });
}

render(html`
  <${App} />
`, document.body);

window.addEventListener('gamepadconnected', (e) => {
  console.log(
    'Gamepad connected at index %d: %s. %d buttons, %d axes.',
    e.gamepad.index,
    e.gamepad.id,
    e.gamepad.buttons.length,
    e.gamepad.axes.length,
  );
});
