/**
 * Tiny WebSocket client with JSON framing and exponential-backoff reconnect.
 * Session auth rides on the httpOnly cookie, sent automatically on the
 * same-origin upgrade request.
 */

export interface WSHandle<Out> {
  send(message: Out): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface WSOptions<In> {
  onMessage(message: In): void;
  onOpen?(): void;
  /** Called when a connection attempt fails or drops (before any retry). */
  onDrop?(attempt: number): void;
  /** Stop reconnecting after this many consecutive failed attempts. */
  maxAttempts?: number;
  /** Called once maxAttempts is exhausted. */
  onGiveUp?(): void;
}

export function connectWS<In, Out>(path: string, options: WSOptions<In>): WSHandle<Out> {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}${path}`;
  const maxAttempts = options.maxAttempts ?? Infinity;

  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let openedOnce = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    if (closedByUser) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0;
      openedOnce = true;
      options.onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        options.onMessage(JSON.parse(event.data as string) as In);
      } catch {
        // Ignore unparseable frames.
      }
    };

    ws.onclose = (event) => {
      ws = null;
      if (closedByUser || event.code === 1000) return;
      scheduleRetry();
    };

    ws.onerror = () => {
      // onclose follows and handles retry.
    };
  }

  function scheduleRetry(): void {
    attempt += 1;
    options.onDrop?.(attempt);
    if (attempt >= maxAttempts && !openedOnce) {
      options.onGiveUp?.();
      return;
    }
    const delay = Math.min(250 * 2 ** Math.min(attempt, 6), 10_000);
    retryTimer = setTimeout(connect, delay);
  }

  function onVisible(): void {
    if (!closedByUser && document.visibilityState === 'visible' && !ws) {
      clearTimeout(retryTimer);
      connect();
    }
  }
  document.addEventListener('visibilitychange', onVisible);

  connect();

  return {
    send(message: Out): void {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    close(): void {
      closedByUser = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close(1000, 'client closed');
      ws = null;
    },
    get isOpen(): boolean {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}
