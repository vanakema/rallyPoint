/**
 * Sync state machine: while syncing, stream positions to the matchmaker
 * every 2 s and wait for the server to form a group. The same store powers
 * both initial group formation (Home) and adding members to an existing
 * group (GroupView).
 */
import type {
  LobbyClientMessage,
  LobbyServerMessage,
} from '@rallypoint/shared/protocol';
import { geo } from './geo.svelte.ts';
import { saveGroupId } from './session.ts';
import { connectWS, type WSHandle } from './ws.ts';

const SEND_INTERVAL_MS = 2_000;

class Lobby {
  status = $state<'idle' | 'syncing' | 'grouped' | 'error'>('idle');
  /** Other syncing users currently in range, per the server. */
  peers = $state(0);
  error = $state<string | null>(null);

  #ws: WSHandle<LobbyClientMessage> | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #onGrouped: ((groupId: string) => void) | null = null;

  start(name: string, onGrouped: (groupId: string) => void, existingGroupId?: string): void {
    if (this.status === 'syncing') return;
    this.status = 'syncing';
    this.peers = 0;
    this.error = null;
    this.#onGrouped = onGrouped;

    this.#ws = connectWS<LobbyServerMessage, LobbyClientMessage>('/ws/lobby', {
      onOpen: () => {
        this.#ws?.send({ t: 'hello', name, groupId: existingGroupId });
        this.#sendPosition();
      },
      onMessage: (message) => this.#handle(message),
      maxAttempts: 5,
      onGiveUp: () => {
        this.error = 'Could not reach the server.';
        this.stop('error');
      },
    });

    this.#timer = setInterval(() => this.#sendPosition(), SEND_INTERVAL_MS);
  }

  stop(finalStatus: 'idle' | 'grouped' | 'error' = 'idle'): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#ws?.close();
    this.#ws = null;
    this.status = finalStatus;
    this.peers = 0;
  }

  #sendPosition(): void {
    const pos = geo.position;
    if (!pos || !this.#ws?.isOpen) return;
    this.#ws.send({ t: 'pos', lat: pos.lat, lng: pos.lng, acc: pos.acc });
  }

  #handle(message: LobbyServerMessage): void {
    switch (message.t) {
      case 'peers':
        this.peers = message.count;
        break;
      case 'grouped': {
        const callback = this.#onGrouped;
        saveGroupId(message.groupId);
        this.stop('grouped');
        callback?.(message.groupId);
        break;
      }
      case 'error':
        this.error = message.message;
        break;
    }
  }
}

export const lobby = new Lobby();
