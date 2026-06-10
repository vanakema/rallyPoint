<script lang="ts">
  import { geo } from '../lib/geo.svelte.ts';
  import { lobby } from '../lib/lobby.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { savedName, saveName } from '../lib/session.ts';

  let name = $state(savedName());

  const syncing = $derived(lobby.status === 'syncing');
  const geoBlocked = $derived(geo.error !== null);

  let nameMissing = $state(false);

  function toggleSync(): void {
    if (syncing) {
      lobby.stop();
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      nameMissing = true;
      setTimeout(() => (nameMissing = false), 1500);
      return;
    }
    saveName(trimmed);
    lobby.start(trimmed, (groupId) => router.navigate(`/app/${groupId}`));
  }
</script>

<main class="home">
  <h1 class="logo">
    <img src="/images/rally-point-logo.png" alt="RallyPoint" />
  </h1>
  <p class="tagline">Gather. Explore. Rally.</p>

  <form
    class="finder"
    class:syncing
    onsubmit={(e) => {
      e.preventDefault();
      toggleSync();
    }}
  >
    <input
      class="name"
      type="text"
      placeholder="Your name"
      maxlength="64"
      autocomplete="given-name"
      bind:value={name}
      disabled={syncing}
    />
    <button class="sync" type="submit" disabled={geoBlocked}>
      {#if syncing}
        <span class="pulse" aria-hidden="true"></span>
        <span class="pulse delay" aria-hidden="true"></span>
        Stop
      {:else}
        Sync
      {/if}
    </button>
  </form>

  {#if geo.error === 'denied'}
    <p class="hint error">Location access is blocked. RallyPoint needs it to find your group — enable location for this site and reload.</p>
  {:else if geo.error === 'unavailable'}
    <p class="hint error">Couldn't get a location fix. Step outside or check your device's location settings.</p>
  {:else if nameMissing}
    <p class="hint error">Enter your name first so your friends know who you are.</p>
  {:else if syncing && !geo.position}
    <p class="hint">Waiting for a GPS fix…</p>
  {:else if syncing}
    <p class="hint">
      Stand next to your friends while they hit <strong>Sync</strong> too.
      {#if lobby.peers > 0}
        <br /><strong>{lobby.peers}</strong> {lobby.peers === 1 ? 'person' : 'people'} nearby…
      {/if}
    </p>
  {:else if lobby.error}
    <p class="hint error">{lobby.error}</p>
  {:else}
    <p class="hint">Type your name, stand together, and everyone taps <strong>Sync</strong>.</p>
  {/if}
</main>

<style>
  .home {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 1.5rem;
    padding-top: calc(1.5rem + env(safe-area-inset-top));
    padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
    background: radial-gradient(ellipse at center, #70b1be 0%, #194650 55%, #04434f 100%);
    text-align: center;
  }

  .logo {
    margin: 0;
  }
  .logo img {
    width: min(72vw, 340px);
    height: auto;
    filter: drop-shadow(0 4px 12px rgb(0 0 0 / 0.35));
  }

  .tagline {
    margin: -0.5rem 0 0.5rem;
    color: var(--text-soft);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-size: 0.8rem;
  }

  .finder {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: rgb(255 255 255 / 0.08);
    border: 1px solid rgb(255 255 255 / 0.15);
    border-radius: 999px;
    padding: 0.5rem;
    backdrop-filter: blur(8px);
  }

  .name {
    border: none;
    outline: none;
    background: white;
    color: #16323a;
    font-size: 1.05rem;
    padding: 0.85rem 1.1rem;
    border-radius: 999px;
    width: min(52vw, 230px);
  }
  .name::placeholder {
    color: #7d99a1;
  }

  .sync {
    position: relative;
    width: 86px;
    height: 86px;
    border-radius: 50%;
    border: none;
    background: #0d2e36;
    color: white;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
    transition: transform 0.15s ease, background 0.3s ease;
  }
  .sync:active {
    transform: scale(0.95);
  }
  .sync:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .syncing .sync {
    background: #b3232e;
  }

  .pulse {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid rgb(255 255 255 / 0.7);
    animation: pulse 2s ease-out infinite;
    pointer-events: none;
  }
  .pulse.delay {
    animation-delay: 1s;
  }
  @keyframes pulse {
    from {
      transform: scale(1);
      opacity: 0.9;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }

  .hint {
    max-width: 34ch;
    min-height: 3lh;
    color: var(--text-soft);
    line-height: 1.5;
    margin: 0;
  }
  .hint.error {
    color: #ffb4ad;
  }
</style>
