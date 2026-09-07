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

/** Current + next metadata when the saved Sonos queue is not the play list. */
export function nowPlayingQueueEntries(
    current?: TrackRef | null,
    next?: TrackRef | null,
): Array<{ title: string; artist: string; album: string; albumArtUri: string }> {
    const entries: Array<{ title: string; artist: string; album: string; albumArtUri: string }> = [];
    const currentTitle = String(current?.title || '').trim();
    if (currentTitle) {
        entries.push({
            title: currentTitle,
            artist: String(current?.artist || '').trim(),
            album: String(current?.album || '').trim(),
            albumArtUri: String(current?.albumArtUri || '').trim(),
        });
    }
    const nextTitle = String(next?.title || '').trim();
    if (nextTitle && normalizeTrackText(nextTitle) !== normalizeTrackText(currentTitle)) {
        entries.push({
            title: nextTitle,
            artist: String(next?.artist || '').trim(),
            album: String(next?.album || '').trim(),
            albumArtUri: String(next?.albumArtUri || '').trim(),
        });
    }
    return entries;
}

/**
 * Track number Next/Prev should seek when playback is a linear list.
 * `null` means fall back to AVTransport Next/Previous (end of list, unknown position).
 */
export function queueSkipTarget(trackNo: number, queueLen: number, delta: 1 | -1, repeatAll: boolean): number | null {
    if (trackNo < 1 || queueLen < 1) {
        return null;
    }
    const target = trackNo + delta;
    if (target > queueLen) {
        return repeatAll ? 1 : null;
    }
    if (target < 1) {
        return repeatAll ? queueLen : null;
    }
    return target;
}

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
