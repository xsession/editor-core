import { deepClone } from './commands.js';
function sortValue(value) {
    if (Array.isArray(value))
        return value.map(sortValue);
    if (value && typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            result[key] = sortValue(value[key]);
        }
        return result;
    }
    return value;
}
export function serializeDocument(document, pretty = true) {
    return JSON.stringify(sortValue(document), null, pretty ? 2 : undefined);
}
export function parseDocument(serialized) {
    const parsed = JSON.parse(serialized);
    if (parsed.schemaVersion !== 1)
        throw new Error(`Unsupported editor schema version: ${String(parsed.schemaVersion)}`);
    if (!parsed.id || typeof parsed.id !== 'string')
        throw new Error('Editor document is missing its id.');
    if (!parsed.settings || !parsed.components || !parsed.wires || !parsed.labels)
        throw new Error('Editor document is missing required collections.');
    return deepClone(parsed);
}
export function cloneDocument(document) {
    return deepClone(document);
}
//# sourceMappingURL=serialization.js.map