<script lang="ts">
  import { untrack } from 'svelte';
  import { compass } from '../lib/heading.svelte.ts';
  import { group } from '../lib/group.svelte.ts';
  import { lobby } from '../lib/lobby.svelte.ts';
  import { pushPermission, subscribeForPush } from '../lib/push.ts';
  import { router } from '../lib/router.svelte.ts';
  import { savedName } from '../lib/session.ts';
  import { setWakeLock } from '../lib/wakelock.ts';
  import CompassPane from './CompassPane.svelte';
  import MembersPane from './MembersPane.svelte';

  // The map (maplibre-gl) is by far the heaviest chunk; load it lazily so
  // the sync screen and group views stay light.
  const mapPaneModule = import('./MapPane.svelte');

  let { groupId }: { groupId: string } = $props();

  type Pane = 'map' | 'members' | 'compass';
  let pane = $state<Pane>('members');
  let addingPeople = $state(false);
  let pushState = $state(pushPermission());

  // Track only the route's groupId — connect() itself mutates store state,
  // which must not re-trigger this effect.
  $effect(() => {
    const id = groupId;
    untrack(() => group.connect(id));
    return () =>
      untrack(() => {
        if (group.groupId === id) group.disconnect();
      });
  });

  // Kicked out, group dissolved, or left: back to the start.
  $effect(() => {
    if (group.status === 'left') router.navigate('/', true);
  });

  // Rallying: keep the screen alive and put the compass front and center,
  // mirroring the 2015 behavior (compass on phones, map elsewhere).
  let wasRallying = false;
  $effect(() => {
    setWakeLock(group.isRallying);
    if (group.isRallying && !wasRallying) {
      pane = compass.status === 'unsupported' ? 'map' : 'compass';
    }
    wasRallying = group.isRallying;
    return () => setWakeLock(false);
  });

  // Auto-subscribe silently when permission was already granted earlier.
  $effect(() => {
    if (group.status === 'online' && pushState === 'granted') {
      void subscribeForPush().then((sub) => sub && group.sendPushSubscription(sub));
    }
  });

  async function enableAlerts(): Promise<void> {
    const sub = await subscribeForPush();
    pushState = pushPermission();
    if (sub) group.sendPushSubscription(sub);
  }

  function leave(): void {
    if (confirm('Leave this group?')) group.leave();
  }

  function startAddingPeople(): void {
    addingPeople = true;
    lobby.start(savedName() || 'Friend', () => {
      addingPeople = false;
    }, groupId);
  }

  function stopAddingPeople(): void {
    lobby.stop();
    addingPeople = false;
  }

  const paneTitle = $derived(
    pane === 'map' ? 'Map' : pane === 'members' ? 'Group' : 'Compass',
  );
</script>

<div class="app-shell">
  <header>
    <button class="icon-btn" onclick={leave} aria-label="Leave group" title="Leave group">
      <svg viewBox="0 0 24 24"><path d="M10 17l-1.41-1.41L12.17 12 8.59 8.41 10 7l5 5-5 5zm-6 4h9v-2H5V5h8V3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1z" transform="scale(-1,1) translate(-24,0)"/></svg>
    </button>
    <h1>{paneTitle} <span class="count">{Object.keys(group.members).length}</span></h1>
    <button class="icon-btn" onclick={startAddingPeople} aria-label="Add people" title="Add people">
      <svg viewBox="0 0 24 24"><path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
    </button>
  </header>

  {#if group.status === 'reconnecting' || group.status === 'connecting'}
    <div class="banner">{group.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>
  {:else if pushState === 'default'}
    <button class="banner action" onclick={enableAlerts}>
      🔔 Enable rally alerts so your group can reach you
    </button>
  {/if}

  <main>
    {#if pane === 'map'}
      {#await mapPaneModule then { default: MapPane }}
        <MapPane />
      {/await}
    {:else if pane === 'members'}
      <MembersPane />
    {:else}
      <CompassPane />
    {/if}
  </main>

  <nav class="tabs" aria-label="View">
    {#each [['map', 'Map'], ['members', 'People'], ['compass', 'Compass']] as [id, label] (id)}
      <button
        class:active={pane === id}
        onclick={() => (pane = id as Pane)}
        aria-pressed={pane === id}
      >
        {label}
      </button>
    {/each}
  </nav>

  <button class="rally" class:active={group.isRallying} onclick={() => group.toggleRally()}>
    {group.isRallying ? 'Stop Rally' : 'Start Rally'}
  </button>
</div>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && addingPeople) stopAddingPeople();
  }}
/>

{#if addingPeople}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) stopAddingPeople();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="Add people" tabindex="-1">
      <h2>Syncing…</h2>
      <p>
        Have the new people open RallyPoint, enter a name, and tap
        <strong>Sync</strong> while standing next to you.
        {#if lobby.peers > 0}
          <br /><strong>{lobby.peers}</strong> nearby…
        {/if}
      </p>
      <button class="btn" onclick={stopAddingPeople}>Stop</button>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    padding-top: calc(0.5rem + env(safe-area-inset-top));
    background: var(--brand);
    color: white;
  }
  header h1 {
    font-size: 1.05rem;
    margin: 0;
    font-weight: 600;
  }
  .count {
    display: inline-block;
    min-width: 1.5em;
    padding: 0 0.35em;
    margin-left: 0.25em;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.18);
    font-size: 0.85em;
    text-align: center;
  }

  .icon-btn {
    width: 42px;
    height: 42px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: white;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .icon-btn:active {
    background: rgb(255 255 255 / 0.15);
  }
  .icon-btn svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }

  .banner {
    background: #0d2e36;
    color: var(--text-soft);
    text-align: center;
    font-size: 0.85rem;
    padding: 0.45rem 0.75rem;
    border: none;
    width: 100%;
  }
  .banner.action {
    color: white;
    cursor: pointer;
  }

  main {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--bg-deep);
    border-top: 1px solid rgb(255 255 255 / 0.08);
  }
  .tabs button {
    padding: 0.7rem 0;
    border: none;
    background: transparent;
    color: var(--text-soft);
    font-size: 0.9rem;
    cursor: pointer;
  }
  .tabs button.active {
    color: white;
    font-weight: 700;
    box-shadow: inset 0 -3px 0 var(--brand-light);
  }

  .rally {
    border: none;
    padding: 0.95rem;
    padding-bottom: calc(0.95rem + env(safe-area-inset-bottom));
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: white;
    background: #1d6f63;
    cursor: pointer;
  }
  .rally.active {
    background: #b3232e;
    animation: throb 1.6s ease-in-out infinite;
  }
  @keyframes throb {
    50% {
      filter: brightness(1.25);
    }
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.55);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .modal {
    background: white;
    color: #16323a;
    border-radius: 16px;
    padding: 1.5rem;
    width: min(85vw, 360px);
    text-align: center;
  }
  .modal h2 {
    margin: 0 0 0.5rem;
  }
  .modal p {
    line-height: 1.5;
  }
  .btn {
    margin-top: 0.75rem;
    padding: 0.7rem 2.2rem;
    border: none;
    border-radius: 999px;
    background: var(--brand);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
