<script lang="ts">
  import { onMount } from 'svelte';
  import { geo } from './lib/geo.svelte.ts';
  import { groupIdFromPath, router } from './lib/router.svelte.ts';
  import { ensureSession, savedGroupId } from './lib/session.ts';
  import GroupView from './views/GroupView.svelte';
  import Home from './views/Home.svelte';

  let ready = $state(false);
  let failed = $state(false);

  const routeGroupId = $derived(groupIdFromPath(router.path));

  onMount(async () => {
    try {
      await ensureSession();
      ready = true;
    } catch (err) {
      console.error('session init failed', err);
      failed = true;
      return;
    }
    geo.start();

    // Rejoin the last group on a fresh visit to /. If membership has lapsed,
    // GroupView finds out from the server and bounces back home.
    const remembered = savedGroupId();
    if (remembered && router.path === '/') {
      router.navigate(`/app/${remembered}`, true);
    }
  });
</script>

{#if failed}
  <main class="boot">
    <p>Could not reach the server. Check your connection and reload.</p>
  </main>
{:else if !ready}
  <main class="boot">
    <div class="spinner" aria-label="Loading"></div>
  </main>
{:else if routeGroupId}
  <GroupView groupId={routeGroupId} />
{:else}
  <Home />
{/if}

<style>
  .boot {
    height: 100dvh;
    display: grid;
    place-items: center;
    color: var(--text-soft);
    padding: 1rem;
    text-align: center;
  }
  .spinner {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 4px solid color-mix(in srgb, var(--brand-light) 30%, transparent);
    border-top-color: var(--brand-light);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
