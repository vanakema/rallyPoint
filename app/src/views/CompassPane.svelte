<script lang="ts">
  import {
    bearingDegrees,
    distanceMeters,
    formatDistance,
    shortestAngleDelta,
  } from '@rallypoint/shared/geo';
  import { onMount, untrack } from 'svelte';
  import { geo } from '../lib/geo.svelte.ts';
  import { group } from '../lib/group.svelte.ts';
  import { compass } from '../lib/heading.svelte.ts';

  onMount(() => compass.start());

  const target = $derived(group.rallyPoint);
  const distance = $derived(
    target && geo.position ? distanceMeters(geo.position, target) : null,
  );
  const bearing = $derived(
    target && geo.position ? bearingDegrees(geo.position, target) : null,
  );

  /**
   * Needle angle relative to the top of the phone. With a live compass the
   * needle points at the rally point no matter how you hold the device;
   * without one it falls back to north-up mode (bearing only).
   */
  const targetAngle = $derived(
    bearing === null ? null : bearing - (compass.heading ?? 0),
  );

  // Accumulate via shortest-arc deltas so the CSS transition never spins the
  // long way around when crossing 0/360. The current angle is read untracked:
  // this effect must follow targetAngle only, never its own output.
  let displayAngle = $state(0);
  $effect(() => {
    const target = targetAngle;
    if (target === null) return;
    const current = untrack(() => displayAngle);
    const normalize = (deg: number) => ((deg % 360) + 360) % 360;
    displayAngle = current + shortestAngleDelta(normalize(current), normalize(target));
  });
</script>

<div class="compass-pane">
  {#if !geo.position}
    <p class="note">Waiting for a GPS fix…</p>
  {:else if !target || group.othersCount === 0}
    <p class="note">No rally point yet — you need group members with live positions.</p>
  {:else}
    <div class="dial" role="img" aria-label="Direction to rally point">
      <div class="ring">
        {#if compass.heading !== null}
          <span class="cardinal" style:transform={`rotate(${-compass.heading}deg)`}>N</span>
        {:else}
          <span class="cardinal">N</span>
        {/if}
      </div>
      <div class="needle" style:transform={`rotate(${displayAngle}deg)`}>
        <svg viewBox="0 0 40 160" aria-hidden="true">
          <polygon points="20,4 32,86 20,72 8,86" fill="#d8262f" />
          <polygon points="20,156 30,86 20,98 10,86" fill="#e9eef0" />
          <circle cx="20" cy="84" r="7" fill="#16323a" stroke="white" stroke-width="3" />
        </svg>
      </div>
    </div>

    <p class="distance">
      <strong>{formatDistance(distance ?? Number.NaN)}</strong>
      <span>to your group's rally point</span>
    </p>

    {#if compass.status === 'needs-permission'}
      <button class="btn" onclick={() => compass.requestPermission()}>
        Enable compass
      </button>
    {:else if compass.heading === null}
      <p class="note small">
        No compass on this device — the needle assumes you're facing north.
      </p>
    {/if}
  {/if}
</div>

<style>
  .compass-pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 1.5rem;
    text-align: center;
  }

  .dial {
    position: relative;
    width: min(68vw, 300px);
    aspect-ratio: 1;
  }

  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid rgb(255 255 255 / 0.18);
    background:
      radial-gradient(circle at center, rgb(255 255 255 / 0.05) 0%, transparent 65%);
  }
  .cardinal {
    position: absolute;
    inset: 6px;
    display: flex;
    justify-content: center;
    color: var(--text-soft);
    font-weight: 700;
    transition: transform 0.3s ease-out;
  }

  .needle {
    position: absolute;
    inset: 12%;
    display: grid;
    place-items: center;
    transition: transform 0.3s ease-out;
    will-change: transform;
  }
  .needle svg {
    height: 100%;
  }

  .distance {
    margin: 0;
    color: var(--text-soft);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .distance strong {
    color: white;
    font-size: 2rem;
    font-variant-numeric: tabular-nums;
  }

  .note {
    color: var(--text-soft);
    line-height: 1.5;
    max-width: 30ch;
  }
  .note.small {
    font-size: 0.85rem;
  }

  .btn {
    padding: 0.7rem 2rem;
    border: none;
    border-radius: 999px;
    background: var(--brand-light);
    color: #06343d;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
