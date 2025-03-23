import { html, render, useState, useEffect } from 'htm/preact';

import { ButtonMapper } from './button-mapper.js';
import { useGamepadPoll } from './controls.js';
/** @import { Mappings } from './mapping.js'; */
import { areMappingsEqual } from './mapping.js';
/** @import { ServerState, RawServerState } from './server.js'; */
import { DEFAULT_STATE, unmapDefaultControls, useMockServer, useServer } from './server.js';
import { Settings } from './settings.js';
/** @import { ControlStates } from './state.js'; */
import { ZERO_STATE } from './state.js';

/**
 * @param {{
 *   mock: RawServerState|undefined,
 * }} props
 */
function App({mock}) {
  const remoteState = useServer();
  const mockState = useMockServer(mock);
  const { state, send } = mock ? mockState : remoteState;
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
  return html`
    <div class="control__container">
      ${state.groups.map(({ name, devices }) => html`
        <${DeviceGroup}
          state=${state}
          groupId=${name}
          deviceIds=${devices}
          controlStates=${controlStates}
          onDisconnect=${onDisconnect}
          onReconnect=${onReconnect}
          buttonMapper=${buttonMapper}
        />
      `)}
    </div>
    <${Settings} />
  `;
}

/**
 * @param {{
 *   state: ServerState,
 *   groupId: string,
 *   deviceIds: string[],
 *   controlStates: ControlStates,
 *   onDisconnect: function(string): void,
 *   onReconnect: function(string): void,
 *   buttonMapper: import('react').ReactNode,
 * }} props
 */
function DeviceGroup({state, groupId, deviceIds, controlStates, onDisconnect, onReconnect, buttonMapper}) {
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
      <div class="control__controls">
        <div class="control__ptr-container">
          <div class="control__roll">
            <div class="control__roll-joystick js-joystick" data-group-id=${groupId} data-type="roll"></div>
          </div>
          <div class="control__pt">
            <div class="control__pt-bg"></div>
            <div class="control__pt-joystick js-joystick" data-group-id=${groupId} data-type="panTilt"></div>
          </div>
        </div>
        <div class="control__zoom">
          <div class="control__zoom-joystick js-joystick" data-group-id=${groupId} data-type="zoom"></div>
        </div>
        <div class="control__focus-container">
          <button
            type="button"
            class="control__focus-autofocus js-button"
            data-group-id=${groupId}
            data-type="autofocus"
            title="1-Shot Auto-Focus"
            aria-label="1-Shot Auto-Focus"
          >
            AF
          </button>
          <div class="control__focus">
            <div class="control__focus-joystick js-joystick" data-group-id=${groupId} data-type="focus"></div>
          </div>
        </div>
      </div>
      <div>
        ${deviceIds.map((id) => {
          const d = state.devices[id];
          return html`
            <div class="control__device">
              <span class="control__device-name">${d.name}</span>
              <button
                type="button"
                class=${d.connected ? 'control__device-disconnect' : 'control__device-connect'}
                onClick=${() => d.connected ? onDisconnect(d.id) : onReconnect(d.id)}
                aria-label=${d.connected ? 'Disconnect' : 'Connect'}
                title=${d.connected ? 'Disconnect' : 'Connect'}
              >
                ${d.connected ? '️⏏' : '🔗'}
              </button>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

/**
 * @returns {RawServerState|undefined}
 */
function parseMockData() {
  const params = new URLSearchParams(window.location.search);
  const mockParam = params.get('mock');
  if (mockParam === null) {
    return undefined;
  }
  if (mockParam === '') {
    return DEFAULT_STATE;
  }
  return JSON.parse(mockParam);
}

render(html`
  <${App}
    mock=${parseMockData()}
  />
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
