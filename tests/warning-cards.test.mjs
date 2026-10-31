import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Window } from 'happy-dom';

// Exercise the actual production bundle and custom elements in a DOM emulator.
// This does not claim a real-browser or Home Assistant live acceptance test.
let window;
const previous = new Map();
before(async () => {
  window = new Window({ url: 'http://localhost/' });
  const names = ['document', 'customElements', 'HTMLElement', 'Element', 'Node',
    'NodeFilter', 'Document', 'DocumentFragment', 'ShadowRoot', 'HTMLSlotElement',
    'CSSStyleSheet', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent'];
  const values = Object.fromEntries(names.map(name => [name, window[name]]));
  values.window = window;
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  await import('../meteoswiss-weather-card.js');
});
after(async () => {
  await window?.happyDOM.close();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

const catalogue = {
  de: { types: { 4: 'Strassenglätte', 12: 'Trockenheit' }, levels: { 4: 'Stufe 4 – grosse Gefahr' } },
  en: { types: { 4: 'Slippery Roads', 12: 'Drought' }, levels: { 4: 'Level 4 – high danger' } },
};

async function show(spec = {}) {
  window.document.body.replaceChildren();
  const id = 'binary_sensor.test_weather_alert';
  const card = window.document.createElement(spec.full ? 'meteoswiss-card' : 'meteoswiss-warning-card');
  const attributes = { alerts: [{ alert_id: 'synthetic-warning', warn_type: 12, warn_type_name: 'Drought',
    warn_level: 4, warn_level_name: 'Level 4 - High danger', outlook: false,
    description: 'Event-specific original provider text.', ...spec.alert }], ...spec.attributes };
  const states = {
    [id]: { entity_id: id, state: spec.state || 'on', attributes },
    'weather.test': { state: 'cloudy', attributes: { temperature: 10, humidity: 70, pressure: 1013, wind_speed: 3 } },
  };
  if (spec.missing) delete states[id];
  if (spec.ranked) states[id] = { state: spec.state || 'warning', attributes: spec.attributes };
  const config = { type: `custom:${spec.full ? 'meteoswiss-card' : 'meteoswiss-warning-card'}`,
    ...(spec.ranked ? { primary_warning_entity: id } : { warning_entity: id }) };
  if (spec.full) Object.assign(config, { entity: 'weather.test', auto_resolve_entities: false,
    show_location: false, show_swiss: false, show_heating: false, show_forecast: false,
    show_temperature: false, show_precipitation: false, show_sunshine: false, show_wind: false });
  card.setConfig(config);
  card.hass = { states, selectedLanguage: spec.language || 'de', language: 'en',
    config: { time_zone: 'Europe/Zurich' }, callWS: async () => ({}) };
  window.document.body.append(card);
  await card.updateComplete;
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  await card.updateComplete;
  return card;
}

for (const full of [false, true]) {
  const name = full ? 'full card' : 'standalone card';
  test(`${name}: v3 drought uses the supplied catalogue`, async () => {
    const card = await show({ full, attributes: { warning_labels: catalogue } });
    assert.match(card.shadowRoot.textContent, /Trockenheit/);
    assert.ok(card.shadowRoot.querySelector('ha-icon[icon="mdi:water-off"]'));
  });
  test(`${name}: successful off is not an active warning`, async () => {
    const card = await show({ full, state: 'off', attributes: { alerts: [] } });
    assert.doesNotMatch(card.shadowRoot.textContent, /Wetterwarnung aktiv/);
    if (!full) assert.match(card.shadowRoot.textContent, /Keine aktiven Wetterwarnungen/);
  });
  test(`${name}: unavailable source is not an all-clear`, async () => {
    const card = await show({ full, state: 'unavailable' });
    assert.match(card.shadowRoot.textContent, /Warnungsdaten nicht verfügbar/);
    assert.doesNotMatch(card.shadowRoot.textContent, /Trockenheit/);
  });
  test(`${name}: configured missing source is explicit`, async () => {
    const card = await show({ full, missing: true });
    assert.match(card.shadowRoot.textContent, /Warnungsdaten nicht verfügbar/);
  });
}

test('original Wind/4 input retains its semantic icon', async () => {
  const card = await show({ alert: { warn_type: 4, warn_type_name: 'Wind' } });
  assert.match(card.shadowRoot.textContent, /Wind/);
  assert.ok(card.shadowRoot.querySelector('ha-icon[icon="mdi:weather-windy"]'));
});

test('v3 Slippery Roads/4 input uses its own catalogue', async () => {
  const card = await show({ alert: { warn_type: 4, warn_type_name: 'Slippery Roads' },
    attributes: { warning_labels: catalogue } });
  assert.match(card.shadowRoot.textContent, /Strassenglätte/);
  assert.ok(card.shadowRoot.querySelector('ha-icon[icon="mdi:car-brake-alert"]'));
});

test('selected English is also used in the real card element', async () => {
  const card = await show({ language: 'en', attributes: { warning_labels: catalogue } });
  assert.match(card.shadowRoot.textContent, /Drought/);
  assert.doesNotMatch(card.shadowRoot.textContent, /Trockenheit/);
});

test('unavailable ranked primary is not intercepted by an all-clear shortcut', async () => {
  const card = await show({ ranked: true, state: 'unavailable', attributes: { has_warning: false } });
  assert.match(card.shadowRoot.textContent, /Warnungsdaten nicht verfügbar/);
});

test('expansion retains original text and Lit escapes markup in the DOM', async () => {
  const description = '<img src=x onerror="window.injected=true"> Original provider text. '.repeat(4);
  const card = await show({ alert: { warn_type: 10, warn_type_name: 'Forest Fire', description } });
  assert.equal(card.shadowRoot.querySelectorAll('img').length, 0);
  assert.doesNotMatch(card.shadowRoot.textContent, /Offenes Feuer streng verboten/);
  const button = card.shadowRoot.querySelector('button');
  assert.ok(button);
  button.click();
  await card.updateComplete;
  assert.ok(card.shadowRoot.textContent.includes(description));
  assert.equal(card.shadowRoot.querySelectorAll('img').length, 0);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(window.injected, undefined);
});

async function showTemperatures({ current = 5.4, high = 11.2, low = 4.1,
  language = 'de', locale } = {}) {
  window.document.body.replaceChildren();
  const card = window.document.createElement('meteoswiss-card');
  card.setConfig({ entity: 'weather.precision', auto_resolve_entities: false,
    show_warnings: false, show_swiss: false, show_heating: false,
    show_temperature: false, show_precipitation: false, show_sunshine: false,
    show_wind: false, show_forecast: true });
  card.hass = { states: { 'weather.precision': { state: 'cloudy', attributes: {
    temperature: current, humidity: 80, pressure: 1029.8, wind_speed: 11.2 } } },
    selectedLanguage: language, language: 'en', locale,
    config: { time_zone: 'Europe/Zurich' }, callWS: async message => ({
      'weather.precision': { forecast: message.forecast_type === 'daily'
        ? [{ datetime: '2026-10-31', temperature: high, templow: low, condition: 'cloudy' }] : [] },
    }) };
  window.document.body.append(card);
  await card.updateComplete;
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  await card.updateComplete;
  return card;
}

for (const spec of [
  { name: 'German fallback language', expected: ['5,4°', 'H:11,2° T:4,1°', '11,2°', '4,1°'] },
  { name: 'English fallback language', language: 'en', expected: ['5.4°', 'H:11.2° T:4.1°', '11.2°', '4.1°'] },
  { name: 'explicit HA decimal-comma preference', language: 'en',
    locale: { language: 'en', number_format: 'decimal_comma', time_format: '24' },
    expected: ['5,4°', 'H:11,2° T:4,1°', '11,2°', '4,1°'] },
  { name: 'explicit HA decimal-point preference', language: 'de',
    locale: { language: 'de', number_format: 'comma_decimal', time_format: '24' },
    expected: ['5.4°', 'H:11.2° T:4.1°', '11.2°', '4.1°'] },
  { name: 'whole and negative values retain one decimal', current: 5, high: 11, low: -4.16,
    expected: ['5,0°', 'H:11,0° T:-4,2°', '11,0°', '-4,2°'] },
  { name: 'unformatted HA preference retains trailing zero', current: 5, high: 11, low: 0,
    locale: { language: 'de', number_format: 'none', time_format: '24' },
    expected: ['5.0°', 'H:11.0° T:0.0°', '11.0°', '0.0°'] },
]) {
  test(`temperature precision: ${spec.name}`, async () => {
    const card = await showTemperatures(spec);
    const values = ['.ms-temp', '.ms-hl', '.ms-forecast-high', '.ms-forecast-low']
      .map(selector => card.shadowRoot.querySelector(selector).textContent.trim());
    assert.deepEqual(values, spec.expected);
  });
}
