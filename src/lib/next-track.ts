/**
 * Next-track helpers.
 *
 * Sonos "next" follows shuffle, repeat and the real playhead (NextTrackMetaData).
 * The queue list is still sequential, so widgets must not treat queue[n+1] as next.
 */

export interface TrackRef {
    title?: string;
    artist?: string;
    album?: string;
    albumArtUri?: string;
}

export interface NextTrackFields {
    title: string;
    artist: string;
    album: string;
    art: string;
}

/** Fields written to `next_*` states. Empty title clears the rest. */
export function nextTrackFields(track?: TrackRef | null): NextTrackFields {
    const title = String(track?.title || '').trim();
    if (!title) {
        return { title: '', artist: '', album: '', art: '' };
    }

    return {
        title,
        artist: String(track?.artist || '').trim(),
        album: String(track?.album || '').trim(),
        art: String(track?.albumArtUri || '').trim(),
    };
}

export function normalizeTrackText(value: string): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** True when a queue row is the Sonos next track (title, and artist when both exist). */
export function isSameQueueTrack(
    item: { title?: string; artist?: string },
    next: { title?: string; artist?: string } | null | undefined,
): boolean {
    const nextTitle = normalizeTrackText(next?.title || '');
    if (!nextTitle) {
        return false;
    }
    if (normalizeTrackText(item.title || '') !== nextTitle) {
        return false;
    }
    const itemArtist = normalizeTrackText(item.artist || '');
    const nextArtist = normalizeTrackText(next?.artist || '');
    return !itemArtist || !nextArtist || itemArtist === nextArtist;
}
