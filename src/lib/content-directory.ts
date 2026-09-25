/**
 * Browse Sonos ContentDirectory (TuneIn, music library, network shares, line-in).
 * Spotify and similar services are listed as sources; their catalogs are browsed
 * via SMAPI in src/lib/smapi.ts.
 */
import * as http from 'node:http';

// These moved to the backend types: they describe the domain, not this transport.
export type { MediaBrowseItem, MediaBrowseResult } from './backend/types';
import type { MediaBrowseItem, MediaBrowseResult } from './backend/types';

const BROWSE_LIMIT = 200;

function xmlEscape(value: string): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodeXml(value: string): string {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function tagText(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? decodeXml(match[1]).trim() : '';
}

function attr(xml: string, name: string): string {
    const match = xml.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? decodeXml(match[1]) : '';
}

function absoluteCover(cover: string, baseUrl: string): string {
    if (!cover) {
        return '';
    }
    if (/^https?:\/\//i.test(cover)) {
        return cover;
    }
    return `${baseUrl.replace(/\/$/, '')}${cover.startsWith('/') ? '' : '/'}${cover}`;
}

function parseDidl(didl: string, baseUrl: string): MediaBrowseItem[] {
    const items: MediaBrowseItem[] = [];

    const push = (chunk: string, isContainer: boolean): void => {
        const id = attr(chunk, 'id');
        const title = tagText(chunk, 'dc:title');
        if (!id && !title) {
            return;
        }
        const uri = tagText(chunk, 'res');
        const klass = tagText(chunk, 'upnp:class').toLowerCase();
        const folder = isContainer || klass.includes('object.container');
        items.push({
            id: id || uri || title,
            title: title || id,
            uri,
            metadata: tagText(chunk, 'r:resmd') || tagText(chunk, 'desc'),
            artist: tagText(chunk, 'dc:creator'),
            album: tagText(chunk, 'upnp:album'),
            cover: absoluteCover(tagText(chunk, 'upnp:albumarturi') || tagText(chunk, 'upnp:albumArtURI'), baseUrl),
            folder: folder && !uri.startsWith('x-rincon-stream:') && !uri.startsWith('x-sonos-htastream:'),
        });
    };

    didl.replace(/<container\b[\s\S]*?<\/container>/gi, chunk => {
        push(chunk, true);
        return '';
    });
    didl.replace(/<item\b[\s\S]*?<\/item>/gi, chunk => {
        push(chunk, false);
        return '';
    });

    return items;
}

function extractDidl(soapXml: string): string {
    const cdata = soapXml.match(/<Result[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Result>/i);
    if (cdata) {
        return cdata[1];
    }
    const tagged = soapXml.match(/<Result[^>]*>([\s\S]*?)<\/Result>/i);
    if (!tagged) {
        return '';
    }
    return decodeXml(tagged[1]);
}

function soapBrowse(baseUrl: string, objectId: string, startIndex = 0): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${xmlEscape(objectId)}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${Math.max(0, Math.floor(startIndex) || 0)}</StartingIndex>
      <RequestedCount>${BROWSE_LIMIT}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

    const url = new URL(`${baseUrl.replace(/\/$/, '')}/MediaServer/ContentDirectory/Control`);
    const payload = Buffer.from(body, 'utf8');

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 1400,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                    SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
                    'CONTENT-LENGTH': payload.length,
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const xml = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`Browse ${objectId} failed: HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(xml);
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(8000, () => {
            req.destroy();
            reject(new Error(`Browse ${objectId} timed out`));
        });
        req.write(payload);
        req.end();
    });
}

const FEATURED_SERVICES = [
    'Spotify',
    'YouTube Music',
    'YouTube',
    'Amazon Music',
    'Apple Music',
    'Deezer',
    'Tidal',
    'SoundCloud',
];

export function mediaItem(partial: Partial<MediaBrowseItem> & Pick<MediaBrowseItem, 'id' | 'title'>): MediaBrowseItem {
    return {
        uri: '',
        metadata: '',
        artist: '',
        album: '',
        cover: '',
        folder: false,
        ...partial,
    };
}

export function matchesMusicService(
    blob: string,
    serviceName: string,
    service?: { id?: number; type?: number },
): boolean {
    const name = serviceName.toLowerCase();
    const text = blob.toLowerCase();

    if (service?.id != null && new RegExp(`(?:^|[?&;])sid=${service.id}(?:\\b|&|$)`).test(text)) {
        return true;
    }

    if (name === 'spotify') {
        return /spotify|x-sonos-spotify|sid=9\b|sa_rincon2311|scdn\.co/.test(text);
    }
    if (name.includes('youtube')) {
        return /youtube|youtu\.be|sid=284\b|sid=677\b|sa_rincon72711|googlevideo/.test(text);
    }
    if (name.includes('amazon')) {
        return /amazon|prime|sid=20199\b/.test(text);
    }
    if (name.includes('apple')) {
        return /apple.?music|sid=204\b/.test(text);
    }
    if (name.includes('deezer')) {
        return /deezer|sid=2\b/.test(text);
    }
    if (name.includes('tidal')) {
        return /tidal|sid=44591\b|sid=303\b/.test(text);
    }
    if (name.includes('soundcloud')) {
        return /soundcloud|sid=160\b/.test(text);
    }
    return text.includes(name);
}

/** HDMI / TV input on Arc, Beam, Playbar, Playbase, Ray and Amp. */
export function tvStreamUri(uuid: string): string {
    return `x-sonos-htastream:${uuid}:spdif`;
}

export function isTvStreamUri(uri: string | undefined): boolean {
    return /^x-sonos-htastream:/i.test(String(uri || ''));
}

export function isLineInStreamUri(uri: string | undefined): boolean {
    return /^x-rincon-stream:/i.test(String(uri || ''));
}

function isFollowCoordinatorUri(uri: string | undefined): boolean {
    return /^x-rincon:RINCON_/i.test(String(uri || ''));
}

/** Queue, playlist, song or radio — not HDMI/TV and not a grouped follower. */
function isNonTvSourceUri(uri: string | undefined): boolean {
    const value = String(uri || '');
    if (!value || isTvStreamUri(value) || isLineInStreamUri(value) || isFollowCoordinatorUri(value)) {
        return false;
    }
    return true;
}

/**
 * HDMI/TV is the current source. AVTransport wins over a leftover currentTrack
 * HDMI URI; a real song/playlist URI wins over a leftover HDMI AVTransport.
 */
export function isPlayingTv(transportUri?: string, trackUri?: string): boolean {
    const av = String(transportUri || '');
    const track = String(trackUri || '');
    if (isNonTvSourceUri(av) || isNonTvSourceUri(track)) {
        return false;
    }
    return isTvStreamUri(av) || isTvStreamUri(track);
}

/** True when AVTransport is the speaker's own Sonos queue (not a cloud playlist or stream). */
export function isQueueUri(uri: string | undefined): boolean {
    return /^x-rincon-queue:/i.test(String(uri || ''));
}

/** Spotify / SMAPI playlist, album or other cloud container. */
export function isCpContainerUri(uri: string | undefined): boolean {
    return /^x-rincon-cpcontainer:/i.test(String(uri || ''));
}

/** Music-library / share playlist (Mediathek, Netzlaufwerk). */
export function isRinconPlaylistUri(uri: string | undefined): boolean {
    return /^x-rincon-playlist:/i.test(String(uri || ''));
}

/** Queue and playlists can seek by track number; radio cannot. */
export function isSeekableListUri(uri: string | undefined): boolean {
    return isQueueUri(uri) || isCpContainerUri(uri) || isRinconPlaylistUri(uri);
}

export function playContextKey(uri: string | undefined): string {
    return String(uri || '')
        .trim()
        .replace(/[?&](?:sid|flags|sn)=[^&]*/gi, '')
        .replace(/[?&]+$/, '')
        .replace(/\?$/, '');
}

export function sidFromMusicUri(blob: string | undefined): number {
    const text = String(blob || '').toLowerCase();
    const sid = Number((String(blob || '').match(/[?&]sid=(\d+)/i) || [])[1]);
    if (sid) {
        return sid;
    }
    if (/spotify|x-sonos-spotify|scdn\.co/.test(text)) {
        return 9;
    }
    if (/tidal/.test(text)) {
        return 44591;
    }
    if (/deezer/.test(text)) {
        return 2;
    }
    if (/apple|itunes|catalog\/pl|catalog\/album/.test(text)) {
        return 204;
    }
    if (/amazon|prime/.test(text)) {
        return 20199;
    }
    if (/youtube|youtu\.be|googlevideo/.test(text)) {
        return 677;
    }
    if (/soundcloud/.test(text)) {
        return 160;
    }
    return 0;
}

/**
 * `x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a…?sid=9&flags=…`
 * → SMAPI service id and the playlist/album object id.
 * `sid` is optional: some CurrentURI values omit the query string.
 */
export function parseCpContainerUri(
    uri: string | undefined,
): { sid: number; objectId: string; browseId: string } | null {
    const value = String(uri || '');
    if (!isCpContainerUri(value)) {
        return null;
    }
    const payload = value.replace(/^x-rincon-cpcontainer:/i, '');
    const browseId = payload.split(/[?&]/)[0].trim();
    if (!browseId) {
        return null;
    }
    const hex = browseId.match(/^([0-9a-f]{8})(.*)$/i);
    const encoded = hex ? hex[2] : browseId;
    let objectId = encoded || browseId;
    try {
        objectId = decodeURIComponent(objectId);
    } catch {
        objectId = objectId.replace(/%3a/gi, ':');
    }
    objectId = objectId.replace(/%3a/gi, ':').trim() || browseId;
    const sid = sidFromMusicUri(`${value} ${objectId}`);
    return { sid, objectId, browseId };
}

export function parseObjectIdAsContainer(
    objectId: string | undefined,
    hintUri?: string,
): { sid: number; objectId: string; browseId: string } | null {
    const id = String(objectId || '').trim();
    if (!id || isFollowCoordinatorUri(id) || isQueueUri(id) || isTvStreamUri(id)) {
        return null;
    }
    if (isCpContainerUri(id)) {
        return parseCpContainerUri(id);
    }
    if (/^[0-9a-f]{8}/i.test(id) || /spotify:|playlist|album|catalog\//i.test(id)) {
        const sidQuery = String(hintUri || '').match(/[?&]sid=\d+/i);
        const query = sidQuery ? `?${sidQuery[0].replace(/^[?&]/, '')}` : '';
        return parseCpContainerUri(`x-rincon-cpcontainer:${id}${query}`);
    }
    return null;
}

/** parentID of the playing item — often the playlist/album object id. */
export function didlParentId(xml: string | undefined): string {
    const source = String(xml || '');
    const decoded = /&lt;(?:DIDL-Lite|item)\b/i.test(source) ? decodeXml(source) : source;
    const match = decoded.match(/\bparentID="([^"]+)"/i) || source.match(/\bparentID="([^"]+)"/i);
    if (!match) {
        return '';
    }
    let id = decodeXml(match[1]).trim();
    try {
        id = decodeURIComponent(id);
    } catch {
        id = id.replace(/%3a/gi, ':');
    }
    return id;
}

/** ContentDirectory / SMAPI ids that can list the tracks of a playing cloud playlist. */
export function cpContainerBrowseIds(container: { sid: number; objectId: string; browseId: string }): string[] {
    const ids: string[] = [];
    const add = (id: string): void => {
        const value = String(id || '').trim();
        if (value && !ids.includes(value)) {
            ids.push(value);
        }
    };
    add(container.browseId);
    if (/^1[0-9a-f]{7}/i.test(container.browseId)) {
        add(`0${container.browseId.slice(1)}`);
    }
    add(container.objectId);
    add(container.objectId.replace(/:/g, '%3a'));
    const encoded = container.objectId.replace(/:/g, '%3a');
    if (/playlist|favorites/i.test(container.objectId)) {
        add(`1006206c${encoded}`);
        add(`0006206c${encoded}`);
    }
    if (/album/i.test(container.objectId)) {
        add(`1004206c${encoded}`);
        add(`0004206c${encoded}`);
    }
    if (/artist/i.test(container.objectId)) {
        add(`100e206c${encoded}`);
        add(`000e206c${encoded}`);
    }
    return ids;
}

/** Cover for queue_html: SMAPI often sends an absolute https URL. */
export function queueCoverUrl(baseUrl: string, cover: string | undefined): string {
    const art = String(cover || '').trim();
    if (!art) {
        return '';
    }
    if (/^https?:\/\//i.test(art)) {
        return art;
    }
    const root = String(baseUrl || '').replace(/\/$/, '');
    return art.startsWith('/') ? `${root}${art}` : `${root}/${art}`;
}

function isPlaceholderTitle(title: string): boolean {
    const text = title.trim();
    if (!text) {
        return true;
    }
    if (/^(x-|https?:|rtsp:|aac:)/i.test(text)) {
        return true;
    }
    return /^(spdif|rincon_)/i.test(text);
}

const TV_FORMAT_NAMES: Record<string, string> = {
    PCM: 'PCM',
    STEREOPCM: 'Stereo PCM',
    STEREOPCM2: 'Stereo PCM',
    '2STEREOPCM': 'Stereo PCM',
    '20PCM': 'Stereo PCM',
    MULTICHANNELPCM: 'Multichannel PCM',
    MULTICHANNEL: 'Multichannel PCM',
    DOLBYDIGITAL: 'Dolby Digital',
    DOLBYDIGITAL51: 'Dolby Digital 5.1',
    DOLBYDIGITALPLUS: 'Dolby Digital Plus',
    DOLBYATMOS: 'Dolby Atmos',
    DOLBYTRUEHD: 'Dolby TrueHD',
    DOLBYMAT: 'Dolby MAT',
    DTS: 'DTS',
    DTSDIGITALSURROUND: 'DTS Digital Surround',
    DTSHD: 'DTS-HD',
    DTSHDMA: 'DTS-HD MA',
    AAC: 'AAC',
};

function formatKey(text: string): string {
    return text
        .toUpperCase()
        .replace(/[_./+-]+/g, ' ')
        .replace(/\b(\d+)\s+(\d+)\b/g, '$1$2')
        .replace(/[^A-Z0-9]+/g, '');
}

/** HDMI audio format from streamContent / title, e.g. Stereo PCM, Dolby Atmos. */
export function tvAudioFormat(text: string | undefined): string {
    const raw = String(text || '').trim();
    if (!raw || isPlaceholderTitle(raw)) {
        return '';
    }
    const mapped = TV_FORMAT_NAMES[formatKey(raw)];
    if (mapped) {
        return mapped;
    }
    if (/pcm|dolby|dts|atmos|truehd|\bmat\b/i.test(raw) && raw.length < 64) {
        return raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return '';
}

export function streamContentFromDidl(xml: string | undefined): string {
    const source = String(xml || '');
    if (!source) {
        return '';
    }
    const decoded = decodeXml(source);
    const match =
        source.match(/<r:streamContent\b[^>]*>([\s\S]*?)<\/r:streamContent>/i) ||
        source.match(/<r:streamcontent\b[^>]*>([\s\S]*?)<\/r:streamcontent>/i) ||
        decoded.match(/<r:streamContent\b[^>]*>([\s\S]*?)<\/r:streamContent>/i) ||
        decoded.match(/<r:streamcontent\b[^>]*>([\s\S]*?)<\/r:streamcontent>/i);
    return match ? decodeXml(match[1]).trim() : '';
}

/** HTAudioIn values that mean no HDMI/SPDIF audio (SoCo / Sonos community). */
const HT_AUDIO_SILENT = new Set([0, 21, 22, 33554454]);

/** DeviceProperties HTAudioIn codes (SoCo / openHAB), named like the Sonos app. */
const HT_AUDIO_IN: Record<number, string> = {
    2: 'Stereo PCM',
    7: 'Dolby Digital 2.0',
    18: 'Dolby Digital 5.1',
    59: 'Dolby Atmos',
    61: 'Dolby Atmos',
    63: 'Dolby Atmos',
    33554434: 'Stereo PCM',
    33554488: 'Dolby Digital 2.0',
    33554490: 'Dolby Digital Plus 2.0',
    33554492: 'Dolby TrueHD 2.0',
    33554494: 'Multichannel PCM 2.0',
    84934658: 'Multichannel PCM 5.1',
    84934713: 'Dolby Digital 5.1',
    84934714: 'Dolby Digital Plus 5.1',
    84934716: 'Dolby TrueHD 5.1',
    84934718: 'Multichannel PCM 5.1',
    84934721: 'DTS 5.1',
    118489090: 'Multichannel PCM 7.1',
    118489146: 'Dolby Digital Plus 7.1',
};

export function isHtAudioSilent(code: number | null | undefined): boolean {
    return code != null && HT_AUDIO_SILENT.has(code);
}

export function htAudioInLabel(code: number): string {
    if (isHtAudioSilent(code)) {
        return '';
    }
    return HT_AUDIO_IN[code] || '';
}

/** Cache for {@link hasHomeTheater}; the hardware behind a base URL does not change at runtime. */
const homeTheaterCache = new Map<string, boolean>();

/**
 * True if the speaker has a TV input (Arc, Beam, Playbar, Playbase, Ray, Amp).
 * `GetZoneInfo` only carries `HTAudioIn` on those models, so its presence is the probe.
 *
 * @param baseUrl `http://<ip>:1400` of the player
 */
export async function hasHomeTheater(baseUrl: string): Promise<boolean> {
    const key = baseUrl.replace(/\/$/, '');
    const cached = homeTheaterCache.get(key);
    if (cached !== undefined) {
        return cached;
    }

    const found = parseHtAudioIn(await soapGetZoneInfo(baseUrl)) != null;
    homeTheaterCache.set(key, found);
    return found;
}

export function parseHtAudioIn(xml: string): number | null {
    const match = String(xml || '').match(/<HTAudioIn>(\d+)<\/HTAudioIn>/i);
    return match ? parseInt(match[1], 10) : null;
}

export function soapGetZoneInfo(baseUrl: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetZoneInfo xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"></u:GetZoneInfo>
  </s:Body>
</s:Envelope>`;

    const url = new URL(`${baseUrl.replace(/\/$/, '')}/DeviceProperties/Control`);
    const payload = Buffer.from(body, 'utf8');

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 1400,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                    SOAPACTION: '"urn:schemas-upnp-org:service:DeviceProperties:1#GetZoneInfo"',
                    'CONTENT-LENGTH': payload.length,
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const xml = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`GetZoneInfo failed: HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(xml);
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('GetZoneInfo timed out'));
        });
        req.write(payload);
        req.end();
    });
}

export function soapGetPositionInfo(baseUrl: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetPositionInfo>
  </s:Body>
</s:Envelope>`;

    const url = new URL(`${baseUrl.replace(/\/$/, '')}/MediaRenderer/AVTransport/Control`);
    const payload = Buffer.from(body, 'utf8');

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 1400,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                    SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"',
                    'CONTENT-LENGTH': payload.length,
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const xml = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`GetPositionInfo failed: HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(xml);
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('GetPositionInfo timed out'));
        });
        req.write(payload);
        req.end();
    });
}

export function soapGetMediaInfo(baseUrl: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetMediaInfo>
  </s:Body>
</s:Envelope>`;

    const url = new URL(`${baseUrl.replace(/\/$/, '')}/MediaRenderer/AVTransport/Control`);
    const payload = Buffer.from(body, 'utf8');

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 1400,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                    SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#GetMediaInfo"',
                    'CONTENT-LENGTH': payload.length,
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const xml = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`GetMediaInfo failed: HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(xml);
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('GetMediaInfo timed out'));
        });
        req.write(payload);
        req.end();
    });
}

export function parseCurrentUri(xml: string | undefined): string {
    const source = String(xml || '');
    let uri = tagText(source, 'CurrentURI');
    if (!uri) {
        uri = tagText(source, 'TrackURI');
    }
    if (/&amp;|&lt;|&gt;|&quot;/.test(uri)) {
        uri = decodeXml(uri);
    }
    return uri.trim();
}

export interface NowPlayingLabels {
    title: string;
    artist: string;
    album: string;
    station: string;
}

/** Friendly now-playing text when Sonos leaves TV HDMI / line-in metadata empty. */
export function nowPlayingLabels(
    track: { uri?: string; title?: string; artist?: string; album?: string; stationName?: string },
    labels: { tv: string; tvHdmi: string; lineIn: string },
    extra?: { metadata?: string },
): NowPlayingLabels {
    const uri = String(track.uri || '');
    const rawTitle = String(track.title || '').trim();
    const artist = String(track.artist || '').trim();
    const album = String(track.album || '').trim();
    const placeholder = isPlaceholderTitle(rawTitle);

    if (isTvStreamUri(uri)) {
        const format =
            tvAudioFormat(rawTitle) || tvAudioFormat(streamContentFromDidl(extra?.metadata)) || tvAudioFormat(artist);
        return {
            title: labels.tv,
            artist: format,
            album,
            station: labels.tv,
        };
    }
    if (isLineInStreamUri(uri)) {
        return {
            title: placeholder ? labels.lineIn : rawTitle,
            artist,
            album,
            station: labels.lineIn,
        };
    }

    return {
        title: rawTitle,
        artist,
        album,
        station: String(track.stationName || '').trim(),
    };
}

export function getMediaRoot(
    services: Record<string, unknown> | undefined,
    labels: { radio: string; library: string; shares: string; lineIn: string; tv: string; tvHdmi: string },
    playerUuid?: string,
    options?: { homeTheater?: boolean },
): MediaBrowseResult {
    const available = Object.keys(services || {});
    const used = new Set<string>();
    const items: MediaBrowseItem[] = [];

    // Only soundbars/amps have an HDMI or optical input. Offering "TV" on a Play:1
    // would produce an x-sonos-htastream URI the speaker rejects.
    if (options?.homeTheater && playerUuid) {
        items.push(
            mediaItem({
                id: 'tv',
                title: labels.tv,
                artist: labels.tvHdmi,
                uri: tvStreamUri(playerUuid),
                folder: false,
            }),
        );
    }

    items.push(mediaItem({ id: 'R:0', title: labels.radio, folder: true }));

    const addService = (name: string): void => {
        const key = name.toLowerCase();
        if (used.has(key)) {
            return;
        }
        used.add(key);
        items.push(mediaItem({ id: `service:${name}`, title: name, folder: true, service: true }));
    };

    // Popular services first, but only the ones the household actually reports.
    FEATURED_SERVICES.forEach(name => {
        const match = available.find(item => item.toLowerCase() === name.toLowerCase());
        if (match) {
            addService(match);
        }
    });

    items.push(
        mediaItem({ id: 'A:', title: labels.library, folder: true }),
        mediaItem({ id: 'S:', title: labels.shares, folder: true }),
        mediaItem({ id: 'AI:', title: labels.lineIn, folder: true }),
    );

    available.sort((a, b) => a.localeCompare(b)).forEach(name => addService(name));

    return { id: 'root', title: '', items };
}

export async function browseMedia(baseUrl: string, objectId: string, startIndex = 0): Promise<MediaBrowseItem[]> {
    const xml = await soapBrowse(baseUrl, objectId, startIndex);
    return parseDidl(extractDidl(xml), baseUrl);
}

/**
 * Tracks of a playing SMAPI playlist/album via the speaker ContentDirectory.
 * The speaker is already signed in to the music service; the adapter SMAPI token is not required.
 */
export async function browseAllTracks(baseUrl: string, objectId: string, maxItems = 400): Promise<MediaBrowseItem[]> {
    const visited = new Set<string>();

    const collect = async (id: string): Promise<MediaBrowseItem[]> => {
        const key = String(id || '').trim();
        if (!key || visited.has(key) || visited.size > 12) {
            return [];
        }
        visited.add(key);
        const tracks: MediaBrowseItem[] = [];
        let start = 0;
        let firstPage: MediaBrowseItem[] = [];
        while (tracks.length < maxItems) {
            const page = await browseMedia(baseUrl, key, start);
            if (start === 0) {
                firstPage = page;
            }
            const pageTracks = page.filter(item => !item.folder && item.title);
            if (!pageTracks.length) {
                break;
            }
            tracks.push(...pageTracks);
            if (page.length < BROWSE_LIMIT) {
                break;
            }
            start += page.length;
        }
        if (tracks.length) {
            return tracks.slice(0, maxItems);
        }
        const folders = firstPage.filter(item => item.folder && item.id && item.id !== key).slice(0, 4);
        for (const folder of folders) {
            const nested = await collect(folder.id);
            if (nested.length) {
                return nested;
            }
        }
        return [];
    };

    return collect(objectId);
}

export function albumArtFromXml(xml: string | undefined): string {
    const source = String(xml || '');
    if (!source) {
        return '';
    }
    const decoded = decodeXml(source);
    const match =
        source.match(/<(?:[\w.-]+:)?albumArtURI\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?albumArtURI>/i) ||
        decoded.match(/<(?:[\w.-]+:)?albumArtURI\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?albumArtURI>/i);
    return match ? decodeXml(match[1]).trim() : '';
}

export function isStreamUri(uri: string): boolean {
    return /^(x-sonosapi-stream:|x-sonosapi-radio:|x-sonosapi-hls:|x-rincon-mp3radio:|x-rincon-stream:|x-sonos-htastream:|pndrradio:|aac:)/i.test(
        uri,
    );
}

export function isOnDemandUri(uri: string): boolean {
    return /^(x-file-cifs:|x-sonos-spotify:|x-sonos-http:|x-sonosprog-http:|x-sonos-mms:|x-rincon-queue:|x-rincon-cpcontainer:|x-sonosapi-hls-static:|spotify:|file:)/i.test(
        String(uri || ''),
    );
}

export function isBroadcastDidl(xml: string | undefined): boolean {
    return /audioBroadcast/i.test(String(xml || ''));
}

export function isTrackDidl(xml: string | undefined): boolean {
    return /musicTrack/i.test(String(xml || ''));
}

/** Recent/queue songs must not follow the TuneIn SetAVTransport path. */
export function shouldPlayAsTrack(
    uri: string,
    metadata?: string,
    hint?: { title?: string; artist?: string; album?: string; duration?: number },
): boolean {
    const playUri = String(uri || '');
    if (isTvStreamUri(playUri) || isLineInStreamUri(playUri)) {
        return false;
    }
    if (isOnDemandUri(playUri) || isTrackDidl(metadata)) {
        return true;
    }
    if (hint && (Number(hint.duration) > 0 || hint.artist || hint.album)) {
        return true;
    }
    if (isRadioLikeUri(playUri) || isStreamUri(playUri) || isBroadcastDidl(metadata)) {
        return false;
    }
    return Boolean(hint?.title || playUri);
}

/** `H:MM:SS` / `MM:SS` from GetPositionInfo. */
export function parseClock(text: string | undefined): number {
    const value = String(text || '').trim();
    if (!value || /not[_ ]?implemented/i.test(value)) {
        return 0;
    }
    const parts = value.split(':').map(part => parseInt(part, 10));
    if (!parts.length || parts.some(part => Number.isNaN(part))) {
        return 0;
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return parts[0];
}

function formatClock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const min = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return hours ? `${hours}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`;
}

export interface PositionInfo {
    uri: string;
    duration: number;
    elapsed: number;
    metadata: string;
    title: string;
    artist: string;
    album: string;
    cover: string;
}

/** TrackURI / duration / DIDL from GetPositionInfo (escaped or raw). */
export function parsePositionInfo(xml: string | undefined): PositionInfo {
    const source = String(xml || '');
    const uri = tagText(source, 'TrackURI');
    const duration = parseClock(tagText(source, 'TrackDuration'));
    const elapsed = parseClock(tagText(source, 'RelTime'));
    let metadata = tagText(source, 'TrackMetaData');
    if (metadata === 'NOT_IMPLEMENTED') {
        metadata = '';
    }
    if (/&lt;(?:DIDL-Lite|item)\b/i.test(metadata)) {
        metadata = decodeXml(metadata);
    }
    return {
        uri,
        duration,
        elapsed,
        metadata,
        title: tagText(metadata, 'dc:title'),
        artist: tagText(metadata, 'dc:creator') || tagText(metadata, 'r:albumArtist'),
        album: tagText(metadata, 'upnp:album'),
        cover: albumArtFromXml(metadata),
    };
}

/** DIDL for a music track so queue / SetAVTransport keep title, artist and art. */
export function trackDidl(info: {
    title?: string;
    artist?: string;
    album?: string;
    uri?: string;
    cover?: string;
    durationSec?: number;
    metadata?: string;
}): string {
    const existing = String(info.metadata || '');
    if (existing.includes('DIDL-Lite') && !isBroadcastDidl(existing)) {
        return existing;
    }
    const title = xmlEscape(info.title || 'Track');
    const artist = xmlEscape(info.artist || '');
    const album = xmlEscape(info.album || '');
    const cover = xmlEscape(info.cover || '');
    const uri = xmlEscape(info.uri || '');
    const duration = info.durationSec && info.durationSec > 0 ? ` duration="${formatClock(info.durationSec)}"` : '';
    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true">${uri ? `<res${duration}>${uri}</res>` : ''}<dc:title>${title}</dc:title>${artist ? `<dc:creator>${artist}</dc:creator>` : ''}${album ? `<upnp:album>${album}</upnp:album>` : ''}${cover ? `<upnp:albumArtURI>${cover}</upnp:albumArtURI>` : ''}<upnp:class>object.item.audioItem.musicTrack</upnp:class></item></DIDL-Lite>`;
}

export function isRadioLikeUri(uri: string): boolean {
    const value = String(uri || '');
    if (isOnDemandUri(value)) {
        return false;
    }
    return (
        isStreamUri(value) || /(?:tunein|radiotime)/i.test(value) || /^x-sonosapi-(?:stream|radio|hls):/i.test(value)
    );
}

/** Public http(s) radio streams need the Sonos mp3radio wrapper; LAN files stay as-is. */
export function isLanHttpUri(uri: string): boolean {
    try {
        const host = new URL(uri).hostname;
        return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?(?:fe80|fc|fd))/i.test(host);
    } catch {
        return false;
    }
}

/** TuneIn often stores the decoded http stream as currentTrack.uri. */
export function wrapHttpRadioUri(uri: string): string {
    const value = String(uri || '').trim();
    if (/^https?:\/\//i.test(value) && !isLanHttpUri(value)) {
        return `x-rincon-mp3radio:${value}`;
    }
    return value;
}

/** Minimal DIDL so TuneIn / radio SetAVTransport does not return HTTP 500. */
export function radioBroadcastDidl(title: string): string {
    const name = xmlEscape(title || 'Radio');
    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><dc:title>${name}</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc></item></DIDL-Lite>`;
}

/** URIs that the player resolves itself (radio, SMAPI containers) — use setAVTransport, not the queue. */
export function isDirectPlayUri(uri: string): boolean {
    return isStreamUri(uri) || /^x-rincon-cpcontainer:/i.test(uri);
}
