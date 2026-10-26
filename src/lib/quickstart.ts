/**
 * Eight shared quick-start slots for the VIS widget (instance state + Admin).
 */
import type { SonosPlayer } from 'sonos-discovery';

import { isTvStreamUri } from './content-directory';

export const QUICKSTART_COUNT = 8;

export interface QuickstartSlot {
    title: string;
    artist: string;
    album: string;
    station: string;
    cover: string;
    uri: string;
    metadata: string;
    favorite: string;
    tv: boolean;
}

function isGroupingUri(uri: string): boolean {
    return /^x-rincon:RINCON_/i.test(uri);
}

function isQueueUri(uri: string): boolean {
    return /^x-rincon-queue:/i.test(uri);
}

export function emptyQuickstart(): QuickstartSlot {
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

export function emptyQuickstarts(): QuickstartSlot[] {
    return Array.from({ length: QUICKSTART_COUNT }, () => emptyQuickstart());
}

export function slotFilled(slot: QuickstartSlot | undefined | null): boolean {
    if (!slot) {
        return false;
    }
    return Boolean(slot.tv || slot.uri || slot.favorite);
}

function asText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

export function normalizeSlot(raw: unknown): QuickstartSlot {
    const slot = emptyQuickstart();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return slot;
    }
    const item = raw as Record<string, unknown>;
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

export function parseQuickstarts(raw: unknown): QuickstartSlot[] {
    let list: unknown[] = [];
    if (Array.isArray(raw)) {
        list = raw;
    } else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                list = parsed;
            }
        } catch {
            list = [];
        }
    }
    const slots = emptyQuickstarts();
    for (let i = 0; i < QUICKSTART_COUNT; i++) {
        slots[i] = normalizeSlot(list[i]);
    }
    return slots;
}

export function anySlotFilled(slots: QuickstartSlot[]): boolean {
    return slots.some(slotFilled);
}

/** URI + metadata that can restore the current source (station, TV, track). */
export function resumeFromPlayer(player: SonosPlayer): { uri: string; metadata: string; tv: boolean } {
    const trackUri = String(player.state?.currentTrack?.uri || '');
    const av = String(player.avTransportUri || '');
    const metadata = typeof player.avTransportUriMetadata === 'string' ? player.avTransportUriMetadata : '';

    if (isTvStreamUri(trackUri) || isTvStreamUri(av)) {
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
