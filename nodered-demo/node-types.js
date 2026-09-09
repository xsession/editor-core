// Palette of Node-RED-like node definitions used to exercise editor-core's
// component/port/wire feature surface (ports, banks, styling, metadata).
import { ComponentBuilder } from '../editor-core/index.js';

export const NODE_TYPES = [
  { type: 'inject', category: 'common', color: '#a6bbcf', inputs: [], outputs: ['out'], hint: 'Injects a message on click or on a timer.' },
  { type: 'debug', category: 'common', color: '#87a980', inputs: ['msg'], outputs: [], hint: 'Logs incoming messages to the debug sidebar.' },
  { type: 'function', category: 'function', color: '#fdd0a2', inputs: ['in'], outputs: ['out'], hint: 'Runs a small script against the message payload.' },
  { type: 'switch', category: 'function', color: '#e2d96e', inputs: ['in'], outputs: ['true', 'false'], hint: 'Routes a message to one of several outputs.' },
  { type: 'change', category: 'function', color: '#e2d96e', inputs: ['in'], outputs: ['out'], hint: 'Sets, changes, deletes or moves properties.' },
  { type: 'delay', category: 'function', color: '#d7bd9c', inputs: ['in'], outputs: ['out'], hint: 'Delays or rate-limits messages.' },
  { type: 'http request', category: 'network', color: '#e6e0f8', inputs: ['in'], outputs: ['out'], hint: 'Makes an HTTP request and returns the response.' },
  { type: 'mqtt out', category: 'network', color: '#e6e0f8', inputs: ['in'], outputs: [], hint: 'Publishes a message to an MQTT topic.' },
];

export const CATEGORIES = ['common', 'function', 'network'];

let counter = 0;
export function nextId(prefix) {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

export function findNodeType(type) {
  return NODE_TYPES.find((definition) => definition.type === type);
}

/** Builds a ComponentNode for a palette definition at the given world position. */
export function createNodeComponent(definition, position) {
  const id = nextId('n');
  const rowCount = Math.max(definition.inputs.length, definition.outputs.length, 1);
  const builder = new ComponentBuilder(id, definition.type, 'device')
    .at(Math.round(position.x), Math.round(position.y))
    .withLabels({ title: definition.type })
    .withStyle({ headerFill: definition.color })
    .withSize(150, Math.max(56, 26 + rowCount * 22))
    .withLayout({ autoHeight: false, autoWidth: false });
  definition.inputs.forEach((label, index) => {
    builder.addPort({
      id: `${id}-in${index}`,
      label,
      side: 'west',
      order: index,
      electricalClass: 'signal-input',
      connectionPolicy: { maximumConnections: 64, allowSelfConnection: false },
    });
  });
  definition.outputs.forEach((label, index) => {
    builder.addPort({
      id: `${id}-out${index}`,
      label,
      side: 'east',
      order: index,
      electricalClass: 'signal-output',
      connectionPolicy: { maximumConnections: 64, allowSelfConnection: false },
    });
  });
  const node = builder.build();
  node.metadata = { nodeType: definition.type };
  return node;
}
