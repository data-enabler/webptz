import { html, useEffect, useRef, useState } from 'htm/preact';

/** @import { StateUpdater } from './hooks.js'; */
/** @import { Mapping, Mappings, PadInput } from './mapping.js'; */
import { waitForGamepadInput, EMPTY_MAPPING, arePadInputsEqual } from './mapping.js';
/** @import { Group } from './server.js'; */

/**
 * @param {{
 *   groups: Group[],
 *   mappings: Mappings,
 *   setMappings: StateUpdater<Mappings|null>,
 *   defaultMappings: Mappings,
 *   setDefaultMappings: function(Mappings): void,
 * }} props
 */
export function ButtonMapper({
  groups,
  mappings,
  setMappings,
  defaultMappings,
  setDefaultMappings,
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetGroup, setTargetGroup] = useState(/** @type {string|null} */(null));
  const [newMappings, setNewMappings] = useState(mappings);
  const dialogRef = useRef(/** @type {HTMLDialogElement|null} */ (null));
  useEffect(() => {
    if (dialogOpen) {
      setNewMappings(mappings);
      dialogRef.current?.showModal();
      dialogRef.current
        ?.querySelector('[autofocus]')
        ?.scrollIntoView();
    } else {
      dialogRef.current?.close();
    }
  }, [dialogOpen, setNewMappings, /* mappings intentionally omitted */]);
  useEffect(() => {
    if (!dialogRef.current) {
      return;
    }
    function closeDialog() {
      if (dialogRef.current?.returnValue === 'save') {
        setMappings(newMappings);
      }
      setDialogOpen(false);
    }
    /** @param {MouseEvent} e */
    function handleClickOutside(e) {
      if (e.target === dialogRef.current) {
        closeDialog();
      }
    }
    dialogRef.current.addEventListener('close', closeDialog);
    dialogRef.current.addEventListener('click', handleClickOutside);
    return () => {
      dialogRef.current?.removeEventListener('close', closeDialog);
      dialogRef.current?.removeEventListener('click', handleClickOutside);
    };
  }, [setMappings, newMappings, setDialogOpen])

  const [target, setTarget] = useState(/** @type {[string, keyof Mapping]|null} */ (null));
  useEffect(() => {
    return waitForGamepadInput(padInput => {
      if (!target) {
        return;
      }
      setNewMappings((/** @type {Mappings} */ m) => {
        const [groupId, inputId] = target;
        const mapping = m[groupId] || EMPTY_MAPPING;
        // I don't know why TypeScript doesn't like this without the superfluous type cast
        const existingPadInputs = mapping[/** @type {keyof Mapping} */(inputId)] || [];
        /** @type {Mappings} */
        const updated = {
          ...m,
          [groupId]: {
            ...mapping,
            [/** @type {keyof Mapping} */(inputId)]: existingPadInputs.concat([padInput])
          }
        };
        return updated;
      });
      setTarget(null);
    });
  }, [target, setTarget, setNewMappings]);

  function clearAll() {
    setNewMappings({});
  }

  function resetAll() {
    setNewMappings(defaultMappings);
  }

  function saveDefaults() {
    setMappings(newMappings);
    setDefaultMappings(newMappings);
  }

  /**
   * @param {PointerEvent} e
   */
  function openDialog(e) {
    setDialogOpen(true);
    const button = /** @type {HTMLButtonElement|null} */(e.target);
    const groupElem = /** @type {HTMLElement|null} */(button?.closest('.js-control'));
    setTargetGroup(groupElem?.dataset.groupId || null);
  }

  return html`
    <button
      type="button"
      class="control__mapping"
      title="Gamepad Controls"
      aria-label="Gamepad Controls"
      onClick=${openDialog}
    >
      🎮
    </button>
    <dialog ref=${dialogRef}>
      <form method="dialog" class="mapper__container">
        <div className="mapper__groups">
          ${groups.map(({ name: groupId }) => {
            const mapping = newMappings[groupId] || EMPTY_MAPPING;
            const defaultMapping = defaultMappings[groupId] || EMPTY_MAPPING;

            /**
             * @type {StateUpdater<Mapping>}
             */
            function setMapping(stateOrUpdater) {
              setNewMappings((/** @type {Mappings} */ prev) => {
                const origMapping = prev[groupId] || EMPTY_MAPPING;
                const newMapping = typeof stateOrUpdater === 'function'
                  ? stateOrUpdater(origMapping)
                  : stateOrUpdater;
                return ({ ...prev, [groupId]: newMapping })
              });
            };

            return html`
              <${MapperGroup}
                name=${groupId}
                mapping=${mapping}
                defaultMapping=${defaultMapping}
                setMapping=${setMapping}
                target=${target}
                setTarget=${setTarget}
                autofocus=${groupId === targetGroup}
              />
            `;
          })}
        </div>
        <div class="mapper__actions">
          <button type="submit">Cancel</button>
          ${' '}
          <button type="button" onClick=${clearAll}>Clear All</button>
          ${' '}
          <button type="button" onClick=${resetAll}>Reset All to Default</button>
          ${' '}
          <button type="button" onClick=${saveDefaults}>Save as Default</button>
          ${' '}
          <button type="submit" value="save">Save</button>
        </div>
      </form>
    </dialog>
  `;
}

/**
 * @param {{
 *   name: string,
 *   mapping: Mapping,
 *   defaultMapping: Mapping,
 *   setMapping: StateUpdater<Mapping>,
 *   target: [string, keyof Mapping]|null,
 *   setTarget: StateUpdater<[string, keyof Mapping]|null>,
 *   autofocus: boolean,
 * }} props
 * @returns
 */
function MapperGroup({
  name,
  mapping,
  defaultMapping,
  setMapping,
  target,
  setTarget,
  autofocus,
}) {
  function clear() {
    setMapping(EMPTY_MAPPING);
  }

  function reset() {
    setMapping(defaultMapping);
  }

  /**
   * @param {keyof Mapping} inputName
   * @returns
   */
  function mappedInputs(inputName) {
    return html`
      <${MappedInputs}
        inputName=${inputName}
        mapping=${mapping}
        defaultMapping=${defaultMapping}
        setMapping=${setMapping}
        isTarget=${target?.[0] === name && target?.[1] === inputName}
        makeTarget=${() => setTarget([name, inputName])}
      />
    `;
  }

  return html`
    <div class="mapper-group" tabindex="-1" autofocus=${autofocus}>
      <header class="mapper-group__heading">
        <h3>${name}</h3>
        ${' '}
        <button type="button" onClick=${clear}>Clear</button>
        ${' '}
        <button type="button" onClick=${reset}>Reset to Default</button>
      </header>
      <div className="mapper-group__inputs">
        ${mappedInputs('panL')}
        <div>
          ${mappedInputs('tiltU')}
          ${mappedInputs('tiltD')}
        </div>
        ${mappedInputs('panR')}
        <div>
          ${mappedInputs('zoomI')}
          ${mappedInputs('zoomO')}
        </div>
        <div>
          ${mappedInputs('rollL')}
          ${mappedInputs('rollR')}
        </div>
        <div>
          ${mappedInputs('focusF')}
          ${mappedInputs('focusN')}
        </div>
        ${mappedInputs('focusA')}
      </div>
    </div>
  `;
}

/**
 * @param {{
 *   inputName: keyof Mapping,
 *   mapping: Mapping,
 *   defaultMapping: Mapping,
 *   setMapping: StateUpdater<Mapping>,
 *   isTarget: boolean,
 *   makeTarget: function(): void,
 * }} props
 */
function MappedInputs({
  inputName,
  mapping,
  defaultMapping,
  setMapping,
  isTarget,
  makeTarget,
}) {
  const padInputs = mapping[inputName] || [];
  const defaultPadInputs = defaultMapping[inputName] || [];
  const lengthChanged = padInputs.length !== defaultPadInputs.length;
  return html`
    <section class="mapper-inputs ${lengthChanged ? 'mapper-inputs--changed' : ''}">
      <h3 class="mapper-inputs__heading">${getInputNameDisplayValue(inputName)}</h3>
      ${padInputs.map((padInput, i) => {
        const changed = !arePadInputsEqual(padInput, defaultPadInputs[i]);
        return html`
          <${MappedInput} inputName=${inputName} padInput=${padInput} index=${i} setMapping=${setMapping} changed=${changed} />
        `;
      })}
      <button class="mapper-inputs__add" type="button" onClick=${makeTarget}>
        ${isTarget ? `Waiting for gamepad input...` : `Add Mapping`}
      </button>
    </section>
  `;
}

/**
 * @param {{
 *   inputName: keyof Mapping,
 *   padInput: PadInput,
 *   index: number,
 *   setMapping: StateUpdater<Mapping>,
 *   changed: boolean,
 * }} props
 * @returns
 */
function MappedInput({
  inputName,
  padInput,
  index,
  setMapping,
  changed,
}) {
  const multiplier = padInput.multiplier;
  const sign = getSign(multiplier);
  const isAnalog = inputName !== 'focusA';

  /**
   * @param {number} val
   */
  function setMultiplier(val) {
    setMapping(m => {
      const padInputs = m[inputName]?.slice() || [];
      padInputs[index] = { ...padInputs[index], multiplier: val * sign };
      /** @type {Mapping} */
      const updated = { ...m, [inputName]: padInputs };
      return updated;
    });
  }
  function remove() {
    setMapping(m => {
      const padInputs = m[inputName]?.slice() || [];
      padInputs.splice(index, 1);
      /** @type {Mapping} */
      const updated = { ...m, [inputName]: padInputs };
      return updated;
    });
  }

  const multiplierInput = html`
    <div class="mapper-input__line2">
      <input
        type="range"
        name=${`mapping[${inputName}][${index}].multiplier`}
        min="0.0"
        max="1.0"
        step="0.1"
        value=${padInput.multiplier * sign}
        onInput=${(/** @type {InputEvent} */ e) => setMultiplier(+/** @type {HTMLInputElement} */(e.target).value)}
      />
    </div>
  `
  const modifiers = padInput.modifiers
    ?.map(m => html`<span><${InputPill} padInput=${m} /> +</span>`);

  return html`
    <div class="mapper-input ${changed ? 'mapper-input--changed' : ''}">
      <div class="mapper-input__line1">
        <span>
          <span class="mapper-input__modifiers">
            ${modifiers}
          </span>
          <${InputPill} padInput=${padInput} />
          ${isAnalog && ` ×${padInput.multiplier.toFixed(1)}`}
        </span>
        ${' '}
        <button type="button" aria-label="Remove" onClick=${remove}>X</button>
      </div>
      ${isAnalog && multiplierInput}
    </div>
  `;
}

/**
 * Like Math.sign, but returns -1 for -0 and 1 for 0
 * @param {number} num 
 * @returns {number}
 */
function getSign(num) {
  if (num < 0 || Object.is(num, -0)) {
    return -1;
  }
  return 1;
}

/**
 * @param {{
 *   padInput: PadInput,
 * }} props
 */
function InputPill({
  padInput,
}) {
  const displayType = getInputTypeDisplayValue(padInput.type);
  return html`
    <span title=${`Gamepad ${padInput.padIndex}, ${padInput.type} ${padInput.inputIndex}`}>
      <span className="mapper-input__pill">
        🎮
        <span className="mapper-input__pill__index">
          ${padInput.padIndex}
        </span>
      </span>
      ${' '}
      <span className="mapper-input__pill">
        ${displayType}
        <span className="mapper-input__pill__index">
          ${padInput.inputIndex}
        </span>
      </span>
    </span>
  `;
}

/**
 * @param {'axis'|'button'} type
 * @returns {string}
 */
function getInputTypeDisplayValue(type) {
  switch (type) {
    case 'axis':
      return '🕹️';
    case 'button':
      return '🔴';
  }
}

/**
 * @param {keyof Mapping} name
 * @returns {string}
 */
function getInputNameDisplayValue(name) {
  switch (name) {
    case 'panL': return 'Pan Left';
    case 'panR': return 'Pan Right';
    case 'tiltU': return 'Tilt Up';
    case 'tiltD': return 'Tilt Down';
    case 'rollL': return 'Roll Left';
    case 'rollR': return 'Roll Right';
    case 'zoomI': return 'Zoom In';
    case 'zoomO': return 'Zoom Out';
    case 'focusF': return 'Focus Far';
    case 'focusN': return 'Focus Near';
    case 'focusA': return 'Auto-Focus';
  }
}
