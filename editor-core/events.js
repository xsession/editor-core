export class TypedEventEmitter {
    listeners = new Map();
    on(type, listener) {
        const collection = this.listeners.get(type) ?? new Set();
        collection.add(listener);
        this.listeners.set(type, collection);
        return () => this.off(type, listener);
    }
    once(type, listener) {
        const dispose = this.on(type, (event) => {
            dispose();
            listener(event);
        });
        return dispose;
    }
    off(type, listener) {
        const collection = this.listeners.get(type);
        collection?.delete(listener);
        if (collection?.size === 0)
            this.listeners.delete(type);
    }
    emit(type, event) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener(event);
        }
    }
    clear() {
        this.listeners.clear();
    }
}
//# sourceMappingURL=events.js.map