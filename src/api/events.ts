import type {
  CancellableEventTypes,
  DocierCancellableEvent,
  DocierEventOf,
  EventBus,
  EventMap,
  ListenerOptions,
} from './types.js';

export interface BusError {
  readonly type: string;
  readonly listener: string;
  readonly message: string;
}

export interface ListenerInfo {
  readonly priority: number;
  readonly order: number;
  readonly deferred: boolean;
  readonly name: string;
  readonly signal: AbortSignal | undefined;
  readonly listener: (event: never) => void;
  readonly once: boolean;
}

export interface EventBusOptions {
  readonly onListenerError?: (error: BusError) => void;
}

export interface EventBusHandle<M extends EventMap> {
  readonly bus: EventBus<M>;
  readonly errors: readonly BusError[];
  readonly dispatching: boolean;
}

const listenerName = (listener: unknown): string => {
  if (typeof listener !== 'function') return 'unknown';
  const name = listener.name;
  return name === '' ? 'anonymous' : name;
};

export const createEventBus = <M extends EventMap>(
  options: EventBusOptions = {},
): EventBusHandle<M> => {
  const listeners = new Map<string, ListenerInfo[]>();
  const catchAll = new Set<(type: string, event: unknown) => void>();
  const errors: BusError[] = [];
  let counter = 0;
  let depth = 0;

  const report = (error: BusError): void => {
    errors.push(error);
    if (options.onListenerError !== undefined) options.onListenerError(error);
  };

  const listFor = (type: string): readonly ListenerInfo[] => {
    const found = listeners.get(type);
    if (found === undefined) return [];
    return [...found].sort(
      (first, second) => second.priority - first.priority || first.order - second.order,
    );
  };

  const remove = (type: string, entry: ListenerInfo): void => {
    const found = listeners.get(type);
    if (found === undefined) return;
    const next = found.filter((candidate) => candidate !== entry);
    if (next.length === 0) listeners.delete(type);
    else listeners.set(type, next);
  };

  const add = <K extends keyof M & string>(
    type: K,
    listener: (event: DocierEventOf<M, K>) => void,
    options2: ListenerOptions,
    once: boolean,
  ): (() => void) => {
    const entry: ListenerInfo = {
      priority: options2.priority ?? 0,
      order: counter,
      deferred: options2.deferred ?? false,
      name: listenerName(listener),
      signal: options2.signal,
      listener: listener as (event: never) => void,
      once,
    };
    counter += 1;
    const found = listeners.get(type);
    if (found === undefined) listeners.set(type, [entry]);
    else found.push(entry);
    const unsubscribe = (): void => remove(type, entry);
    if (options2.signal !== undefined) {
      if (options2.signal.aborted) unsubscribe();
      else options2.signal.addEventListener('abort', unsubscribe, { once: true });
    }
    return unsubscribe;
  };

  const deliver = (type: string, entry: ListenerInfo, event: unknown): void => {
    if (entry.signal?.aborted) return;
    try {
      (entry.listener as unknown as (value: unknown) => void)(event);
    } catch (cause) {
      report({
        type,
        listener: entry.name,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const notify = (type: string, event: unknown): void => {
    for (const entry of listFor(type)) {
      if (entry.once) remove(type, entry);
      if (entry.deferred) {
        queueMicrotask(() => deliver(type, entry, event));
        continue;
      }
      deliver(type, entry, event);
    }
    for (const listener of catchAll) {
      try {
        listener(type, event);
      } catch (cause) {
        report({
          type,
          listener: listenerName(listener),
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  };

  const emit = <K extends keyof M & string>(type: K, payload: M[K]): void => {
    depth += 1;
    try {
      notify(type, payload);
    } finally {
      depth -= 1;
    }
  };

  const dispatch = <K extends CancellableEventTypes<M>>(
    type: K,
    payload: M[K],
  ): DocierCancellableEvent<M[K]> => {
    let prevented = false;
    const record: DocierCancellableEvent<M[K]> = {
      payload,
      preventDefault: () => {
        prevented = true;
      },
      get defaultPrevented(): boolean {
        return prevented;
      },
    };
    if (depth > 0) {
      report({
        type: String(type),
        listener: 'registry',
        message: 'a cancellable event was dispatched re-entrantly and was refused',
      });
      return record;
    }
    depth += 1;
    try {
      for (const entry of listFor(String(type))) {
        if (entry.once) remove(String(type), entry);
        if (entry.deferred) continue;
        deliver(String(type), entry, record);
      }
      for (const listener of catchAll) {
        try {
          listener(String(type), record);
        } catch (cause) {
          report({
            type: String(type),
            listener: listenerName(listener),
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    } finally {
      depth -= 1;
    }
    return record;
  };

  const bus: EventBus<M> = {
    on: (type, listener, options2) => add(type, listener, options2 ?? {}, false),
    once: (type, listener) => add(type, listener, {}, true),
    off: (type, listener) => {
      const found = listeners.get(String(type));
      if (found === undefined) return;
      for (const entry of [...found]) {
        if (entry.listener === (listener as unknown as (event: never) => void)) {
          remove(String(type), entry);
        }
      }
    },
    onAny: (listener) => {
      catchAll.add(listener);
      return () => {
        catchAll.delete(listener);
      };
    },
    emit,
    dispatch,
    hasListeners: (type) => (listeners.get(String(type))?.length ?? 0) > 0,
  };

  return {
    bus,
    errors,
    get dispatching(): boolean {
      return depth > 0;
    },
  };
};
