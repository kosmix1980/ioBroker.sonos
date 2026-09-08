"use strict";
/**
 * Next-track helpers.
 *
 * Sonos "next" follows shuffle, repeat and the real playhead (NextTrackMetaData).
 * The queue list is still sequential, so widgets must not treat queue[n+1] as next.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextTrackFields = nextTrackFields;
exports.normalizeTrackText = normalizeTrackText;
exports.nowPlayingQueueEntries = nowPlayingQueueEntries;
exports.queueSkipTarget = queueSkipTarget;
exports.isSameQueueTrack = isSameQueueTrack;
exports.queueContainsTrack = queueContainsTrack;
/** Fields written to `next_*` states. Empty title clears the rest. */
function nextTrackFields(track) {
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
function normalizeTrackText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
/** Current + next metadata when the saved Sonos queue is not the play list. */
function nowPlayingQueueEntries(current, next) {
    const entries = [];
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
function queueSkipTarget(trackNo, queueLen, delta, repeatAll) {
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
function isSameQueueTrack(item, next) {
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
/** True when the playing title is a row of this list. */
function queueContainsTrack(entries, track) {
    if (!entries?.length || !String(track?.title || '').trim()) {
        return false;
    }
    return entries.some(item => isSameQueueTrack(item, track));
}
//# sourceMappingURL=next-track.js.map