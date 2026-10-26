"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUICKSTART_COUNT = void 0;
exports.emptyQuickstart = emptyQuickstart;
exports.emptyQuickstarts = emptyQuickstarts;
exports.slotFilled = slotFilled;
exports.normalizeSlot = normalizeSlot;
exports.parseQuickstarts = parseQuickstarts;
exports.anySlotFilled = anySlotFilled;
exports.resumeFromPlayer = resumeFromPlayer;
const content_directory_1 = require("./content-directory");
exports.QUICKSTART_COUNT = 8;
function isGroupingUri(uri) {
    return /^x-rincon:RINCON_/i.test(uri);
}
function isQueueUri(uri) {
    return /^x-rincon-queue:/i.test(uri);
}
function emptyQuickstart() {
    return {
        title: '',
        artist: '',
        album: '',
        station: '',
        cover: '',
        uri: '',
        metadata: '',
        favorite: '',
        tv: false,
    };
}
function emptyQuickstarts() {
    return Array.from({ length: exports.QUICKSTART_COUNT }, () => emptyQuickstart());
}
function slotFilled(slot) {
    if (!slot) {
        return false;
    }
    return Boolean(slot.tv || slot.uri || slot.favorite);
}
function asText(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
function normalizeSlot(raw) {
    const slot = emptyQuickstart();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return slot;
    }
    const item = raw;
    slot.title = asText(item.title).trim();
    slot.artist = asText(item.artist).trim();
    slot.album = asText(item.album).trim();
    slot.station = asText(item.station).trim();
    slot.cover = asText(item.cover).trim();
    slot.uri = asText(item.uri).trim();
    slot.metadata = asText(item.metadata);
    slot.favorite = asText(item.favorite).trim();
    slot.tv = item.tv === true || item.tv === 'true';
    return slot;
}
function parseQuickstarts(raw) {
    let list = [];
    if (Array.isArray(raw)) {
        list = raw;
    }
    else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                list = parsed;
            }
        }
        catch {
            list = [];
        }
    }
    const slots = emptyQuickstarts();
    for (let i = 0; i < exports.QUICKSTART_COUNT; i++) {
        slots[i] = normalizeSlot(list[i]);
    }
    return slots;
}
function anySlotFilled(slots) {
    return slots.some(slotFilled);
}
/** URI + metadata that can restore the current source (station, TV, track). */
function resumeFromPlayer(player) {
    const trackUri = String(player.state?.currentTrack?.uri || '');
    const av = String(player.avTransportUri || '');
    const metadata = typeof player.avTransportUriMetadata === 'string' ? player.avTransportUriMetadata : '';
    if ((0, content_directory_1.isTvStreamUri)(trackUri) || (0, content_directory_1.isTvStreamUri)(av)) {
        return { uri: '', metadata: '', tv: true };
    }
    if (av && !isGroupingUri(av) && !isQueueUri(av)) {
        return { uri: av, metadata, tv: false };
    }
    if (trackUri && !isGroupingUri(trackUri)) {
        return { uri: trackUri, metadata, tv: false };
    }
    return { uri: '', metadata, tv: false };
}
//# sourceMappingURL=quickstart.js.map