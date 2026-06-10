<script lang="ts">
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount } from 'svelte';
  import { geo } from '../lib/geo.svelte.ts';
  import { group } from '../lib/group.svelte.ts';
  import { currentUserId } from '../lib/session.ts';

  let container: HTMLDivElement;
  let map: maplibregl.Map | null = null;
  let mapReady = $state(false);
  let userMoved = $state(false);

  const markers = new Map<string, maplibregl.Marker>();
  let flagMarker: maplibregl.Marker | null = null;

  onMount(() => {
    map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [geo.position?.lng ?? 0, geo.position?.lat ?? 0],
      zoom: geo.position ? 16 : 1,
      attributionControl: { compact: true },
    });
    map.on('load', () => (mapReady = true));
    map.on('dragstart', () => (userMoved = true));
    map.on('zoomstart', (e) => {
      if (e.originalEvent) userMoved = true;
    });
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      flagMarker?.remove();
      map?.remove();
      map = null;
    };
  });

  function dotElement(name: string, isSelf: boolean): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `member-marker${isSelf ? ' self' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = isSelf ? 'You' : name;
    el.append(dot, label);
    return el;
  }

  function flagElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'rally-flag';
    el.textContent = '🚩';
    return el;
  }

  // Sync markers with live member positions.
  $effect(() => {
    if (!map || !mapReady) return;
    const me = currentUserId();
    const seen = new Set<string>();

    for (const member of Object.values(group.members)) {
      if (!member.pos) continue;
      seen.add(member.id);
      const lngLat: [number, number] = [member.pos.lng, member.pos.lat];
      let marker = markers.get(member.id);
      if (!marker) {
        marker = new maplibregl.Marker({ element: dotElement(member.name, member.id === me) })
          .setLngLat(lngLat)
          .addTo(map);
        markers.set(member.id, marker);
      } else {
        marker.setLngLat(lngLat);
      }
      marker.getElement().classList.toggle('offline', !member.online);
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    const rallyPoint = group.rallyPoint;
    if (rallyPoint && seen.size > 1) {
      const lngLat: [number, number] = [rallyPoint.lng, rallyPoint.lat];
      if (!flagMarker) {
        flagMarker = new maplibregl.Marker({ element: flagElement(), anchor: 'bottom' })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        flagMarker.setLngLat(lngLat);
      }
    } else if (flagMarker) {
      flagMarker.remove();
      flagMarker = null;
    }

    if (!userMoved && seen.size > 0) fitAll();
  });

  function fitAll(): void {
    if (!map) return;
    const points = Object.values(group.members)
      .map((m) => m.pos)
      .filter((p) => p !== null);
    if (geo.position) points.push({ ...geo.position });
    if (points.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 500 });
  }

  function recenter(): void {
    userMoved = false;
    fitAll();
  }
</script>

<div class="map-wrap">
  <div class="map" bind:this={container}></div>
  {#if userMoved}
    <button class="recenter" onclick={recenter} aria-label="Re-center map">⌖</button>
  {/if}
</div>

<style>
  .map-wrap,
  .map {
    position: absolute;
    inset: 0;
  }

  .recenter {
    position: absolute;
    right: 0.85rem;
    bottom: 0.85rem;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    font-size: 1.6rem;
    background: white;
    color: #16323a;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
    cursor: pointer;
    z-index: 5;
  }

  :global(.member-marker) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  :global(.member-marker .dot) {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #286f7e;
    border: 2.5px solid white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }
  :global(.member-marker.self .dot) {
    background: #d8262f;
  }
  :global(.member-marker.offline) {
    opacity: 0.55;
  }
  :global(.member-marker .label) {
    font-size: 11px;
    font-weight: 700;
    color: #16323a;
    background: rgb(255 255 255 / 0.85);
    padding: 0 5px;
    border-radius: 6px;
    white-space: nowrap;
  }
  :global(.rally-flag) {
    font-size: 30px;
    line-height: 1;
    filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.4));
  }
</style>
