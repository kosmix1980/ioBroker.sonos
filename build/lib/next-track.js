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
exports.isSameQueueTrack = isSameQueueTrack;
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
/** True when a queue row is the Sonos next track (title, and artist when both exist). */
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
//# sourceMappingURL=next-track.js.map