export type EventListener<T> = (event: T) => void;

export class TypedEventEmitter<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<EventListener<unknown>>>();

  public on<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): () => void {
    const collection = this.listeners.get(type) ?? new Set<EventListener<unknown>>();
    collection.add(listener as EventListener<unknown>);
    this.listeners.set(type, collection);
    return () => this.off(type, listener);
  }

  public once<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): () => void {
    const dispose = this.on(type, (event) => {
      dispose();
      listener(event);
    });
    return dispose;
  }

  public off<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): void {
    const collection = this.listeners.get(type);
    collection?.delete(listener as EventListener<unknown>);
    if (collection?.size === 0) this.listeners.delete(type);
  }

  public emit<TKey extends keyof TEvents>(type: TKey, event: TEvents[TKey]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      (listener as EventListener<TEvents[TKey]>)(event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
