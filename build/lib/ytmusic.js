"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isYoutubeMusicName = isYoutubeMusicName;
exports.searchYoutubeMusic = searchYoutubeMusic;
/**
 * YouTube Music catalog search via InnerTube (the public web client).
 * Playback is not streamed here: results get a Sonos SMAPI URI (sid=284) so
 * the speaker can resolve the title through the official YouTube Music account.
 */
const content_directory_1 = require("./content-directory");
const SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&alt=json&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const CLIENT_VERSION = '1.20240724.00.00';
/** InnerTube filter: songs */
const SONGS_PARAMS = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ==';
const YTM_SID = 284;
const YTM_TYPE = 72711;
function isYoutubeMusicName(name) {
    return /youtube/i.test(name);
}
function xmlEscape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function colonEncode(id) {
    return id.replace(/:/g, '%3a');
}
function runsText(value) {
    if (!value || typeof value !== 'object') {
        return '';
    }
    const obj = value;
    if (typeof obj.simpleText === 'string') {
        return obj.simpleText;
    }
    if (Array.isArray(obj.runs)) {
        return obj.runs
            .map(run => {
            if (!run || typeof run !== 'object' || !('text' in run)) {
                return '';
            }
            const text = run.text;
            return typeof text === 'string' ? text : '';
        })
            .join('');
    }
    return '';
}
function firstString(obj, key) {
    if (!obj || typeof obj !== 'object') {
        return '';
    }
    const value = obj[key];
    return typeof value === 'string' ? value : '';
}
function findStringField(obj, key) {
    let found = '';
    const visit = (node) => {
        if (found || node == null) {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (typeof node !== 'object') {
            return;
        }
        const record = node;
        if (typeof record[key] === 'string' && record[key]) {
            found = record[key];
            return;
        }
        Object.values(record).forEach(visit);
    };
    visit(obj);
    return found;
}
function collectRenderers(obj) {
    const out = [];
    const visit = (node) => {
        if (node == null) {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (typeof node !== 'object') {
            return;
        }
        const record = node;
        if (record.musicResponsiveListItemRenderer) {
            out.push(record.musicResponsiveListItemRenderer);
        }
        Object.values(record).forEach(visit);
    };
    visit(obj);
    return out;
}
function flexColumns(renderer) {
    if (!renderer || typeof renderer !== 'object') {
        return [];
    }
    const cols = renderer.flexColumns;
    if (!Array.isArray(cols)) {
        return [];
    }
    return cols
        .map(col => {
        const inner = col && typeof col === 'object'
            ? col
                .musicResponsiveListItemFlexColumnRenderer
            : undefined;
        return runsText(inner?.text).trim();
    })
        .filter(Boolean);
}
function didl(itemId, title, artist, album) {
    const desc = `SA_RINCON${YTM_TYPE}_X_#Svc${YTM_TYPE}-0-Token`;
    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
  <item id="${xmlEscape(itemId)}" parentID="-1" restricted="true">
    <dc:title>${xmlEscape(title)}</dc:title>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <upnp:artist>${xmlEscape(artist)}</upnp:artist>
    <upnp:album>${xmlEscape(album)}</upnp:album>
    <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${xmlEscape(desc)}</desc>
  </item>
</DIDL-Lite>`;
}
function toPlayItem(videoId, title, artist, album, cover, sn) {
    const objectId = `track:${videoId}`;
    const encoded = colonEncode(objectId);
    const uri = `x-sonos-http:${encoded}?sid=${YTM_SID}&flags=8224&sn=${sn || '0'}`;
    return (0, content_directory_1.mediaItem)({
        id: `ytm:${videoId}`,
        title,
        uri,
        metadata: didl(`00032020${encoded}`, title, artist, album),
        artist,
        album: album || 'YouTube Music',
        cover: cover || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        folder: false,
    });
}
async function searchYoutubeMusic(query, sn, german) {
    const term = query.trim();
    if (!term) {
        return { items: [] };
    }
    const payload = {
        context: {
            client: {
                clientName: 'WEB_REMIX',
                clientVersion: CLIENT_VERSION,
                hl: german ? 'de' : 'en',
                gl: german ? 'DE' : 'US',
            },
        },
        query: term,
        params: SONGS_PARAMS,
    };
    const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://music.youtube.com',
            Referer: 'https://music.youtube.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
        throw new Error(`YouTube Music search failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    const seen = new Set();
    const items = [];
    for (const renderer of collectRenderers(data)) {
        const videoId = findStringField(renderer, 'videoId') || firstString(renderer, 'videoId');
        if (!videoId || seen.has(videoId)) {
            continue;
        }
        const cols = flexColumns(renderer);
        const title = cols[0] || videoId;
        const meta = (cols[1] || '').split('•').map(part => part.trim());
        const artist = meta[0] || '';
        const album = meta[1] && !/^\d+:\d+/.test(meta[1]) ? meta[1] : '';
        seen.add(videoId);
        items.push(toPlayItem(videoId, title, artist, album, '', sn));
        if (items.length >= 25) {
            break;
        }
    }
    return {
        items,
        hint: german
            ? 'Suche über YouTube Music. Play geht über den Speaker (sid=284) — wenn nichts startet, den Titel in der Sonos-App als Favorit speichern.'
            : 'Search uses YouTube Music. Play goes through the speaker (sid=284) — if nothing starts, save the title as a favorite in the Sonos app.',
    };
}
//# sourceMappingURL=ytmusic.js.map