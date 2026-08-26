export type EventListener<T> = (event: T) => void;
export declare class TypedEventEmitter<TEvents extends object> {
    private readonly listeners;
    on<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): () => void;
    once<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): () => void;
    off<TKey extends keyof TEvents>(type: TKey, listener: EventListener<TEvents[TKey]>): void;
    emit<TKey extends keyof TEvents>(type: TKey, event: TEvents[TKey]): void;
    clear(): void;
}
//# sourceMappingURL=events.d.ts.map