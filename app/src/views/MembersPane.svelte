<script lang="ts">
  import { formatDistance } from '@rallypoint/shared/geo';
  import { group } from '../lib/group.svelte.ts';
  import { currentUserId } from '../lib/session.ts';

  const sorted = $derived(
    Object.values(group.members).sort((a, b) => {
      if (a.id === currentUserId()) return -1;
      if (b.id === currentUserId()) return 1;
      return a.name.localeCompare(b.name);
    }),
  );
</script>

<div class="members">
  <ul>
    {#each sorted as member (member.id)}
      {@const isSelf = member.id === currentUserId()}
      {@const dist = isSelf ? null : group.distanceTo(member)}
      <li>
        <span class="status" class:online={member.online} aria-hidden="true"></span>
        <span class="name">
          {member.name}{#if isSelf}&nbsp;<em>(you)</em>{/if}
        </span>
        <span class="dist">
          {#if isSelf}
            —
          {:else if dist !== null}
            {formatDistance(dist)}
          {:else if member.online}
            locating…
          {:else}
            offline
          {/if}
        </span>
      </li>
    {/each}
  </ul>
  {#if sorted.length <= 1}
    <p class="empty">
      You're the only one here. Tap the <strong>add people</strong> button up
      top and have friends sync next to you.
    </p>
  {/if}
</div>

<style>
  .members {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.95rem 1.25rem;
    border-bottom: 1px solid rgb(255 255 255 / 0.07);
    color: white;
    font-size: 1.05rem;
  }

  .status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #5a7a82;
    flex-shrink: 0;
  }
  .status.online {
    background: #38d39f;
    box-shadow: 0 0 6px rgb(56 211 159 / 0.7);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name em {
    color: var(--text-soft);
    font-style: normal;
    font-size: 0.85em;
  }

  .dist {
    color: var(--text-soft);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--text-soft);
    text-align: center;
    padding: 2rem 1.5rem;
    line-height: 1.6;
  }
</style>
