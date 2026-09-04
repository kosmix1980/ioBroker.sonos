"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaItem = mediaItem;
exports.matchesMusicService = matchesMusicService;
exports.tvStreamUri = tvStreamUri;
exports.isTvStreamUri = isTvStreamUri;
exports.isLineInStreamUri = isLineInStreamUri;
exports.tvAudioFormat = tvAudioFormat;
exports.streamContentFromDidl = streamContentFromDidl;
exports.htAudioInLabel = htAudioInLabel;
exports.parseHtAudioIn = parseHtAudioIn;
exports.soapGetZoneInfo = soapGetZoneInfo;
exports.soapGetPositionInfo = soapGetPositionInfo;
exports.nowPlayingLabels = nowPlayingLabels;
exports.getMediaRoot = getMediaRoot;
exports.browseMedia = browseMedia;
exports.isStreamUri = isStreamUri;
exports.isDirectPlayUri = isDirectPlayUri;
/**
 * Browse Sonos ContentDirectory (TuneIn, music library, network shares, line-in).
 * Spotify and similar services are listed as sources; their catalogs are browsed
 * via SMAPI in src/lib/smapi.ts.
 */
const http = __importStar(require("node:http"));
const BROWSE_LIMIT = 200;
function xmlEscape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decodeXml(value) {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}
function tagText(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? decodeXml(match[1]).trim() : '';
}
function attr(xml, name) {
    const match = xml.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? decodeXml(match[1]) : '';
}
function absoluteCover(cover, baseUrl) {
    if (!cover) {
        return '';
    }
    if (/^https?:\/\//i.test(cover)) {
        return cover;
    }
    return `${baseUrl.replace(/\/$/, '')}${cover.startsWith('/') ? '' : '/'}${cover}`;
}
function parseDidl(didl, baseUrl) {
    const items = [];
    const push = (chunk, isContainer) => {
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
function extractDidl(soapXml) {
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
function soapBrowse(baseUrl, objectId) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${xmlEscape(objectId)}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>${BROWSE_LIMIT}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/MediaServer/ContentDirectory/Control`);
    const payload = Buffer.from(body, 'utf8');
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 1400,
            path: url.pathname,
            method: 'POST',
            headers: {
                'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
                'CONTENT-LENGTH': payload.length,
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const xml = Buffer.concat(chunks).toString('utf8');
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`Browse ${objectId} failed: HTTP ${res.statusCode}`));
                    return;
                }
                resolve(xml);
            });
        });
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
function mediaItem(partial) {
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
function matchesMusicService(blob, serviceName, service) {
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
function tvStreamUri(uuid) {
    return `x-sonos-htastream:${uuid}:spdif`;
}
function isTvStreamUri(uri) {
    return /^x-sonos-htastream:/i.test(String(uri || ''));
}
function isLineInStreamUri(uri) {
    return /^x-rincon-stream:/i.test(String(uri || ''));
}
function isPlaceholderTitle(title) {
    const text = title.trim();
    if (!text) {
        return true;
    }
    if (/^(x-|https?:|rtsp:|aac:)/i.test(text)) {
        return true;
    }
    return /^(spdif|rincon_)/i.test(text);
}
const TV_FORMAT_NAMES = {
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
function formatKey(text) {
    return text
        .toUpperCase()
        .replace(/[_./+-]+/g, ' ')
        .replace(/\b(\d+)\s+(\d+)\b/g, '$1$2')
        .replace(/[^A-Z0-9]+/g, '');
}
/** HDMI audio format from streamContent / title, e.g. Stereo PCM, Dolby Atmos. */
function tvAudioFormat(text) {
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
function streamContentFromDidl(xml) {
    const source = String(xml || '');
    if (!source) {
        return '';
    }
    const decoded = decodeXml(source);
    const match = source.match(/<r:streamContent\b[^>]*>([\s\S]*?)<\/r:streamContent>/i) ||
        source.match(/<r:streamcontent\b[^>]*>([\s\S]*?)<\/r:streamcontent>/i) ||
        decoded.match(/<r:streamContent\b[^>]*>([\s\S]*?)<\/r:streamContent>/i) ||
        decoded.match(/<r:streamcontent\b[^>]*>([\s\S]*?)<\/r:streamcontent>/i);
    return match ? decodeXml(match[1]).trim() : '';
}
/** DeviceProperties HTAudioIn codes (SoCo / openHAB), named like the Sonos app. */
const HT_AUDIO_IN = {
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
function htAudioInLabel(code) {
    return HT_AUDIO_IN[code] || '';
}
function parseHtAudioIn(xml) {
    const match = String(xml || '').match(/<HTAudioIn>(\d+)<\/HTAudioIn>/i);
    return match ? parseInt(match[1], 10) : null;
}
function soapGetZoneInfo(baseUrl) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetZoneInfo xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"></u:GetZoneInfo>
  </s:Body>
</s:Envelope>`;
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/DeviceProperties/Control`);
    const payload = Buffer.from(body, 'utf8');
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 1400,
            path: url.pathname,
            method: 'POST',
            headers: {
                'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                SOAPACTION: '"urn:schemas-upnp-org:service:DeviceProperties:1#GetZoneInfo"',
                'CONTENT-LENGTH': payload.length,
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const xml = Buffer.concat(chunks).toString('utf8');
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`GetZoneInfo failed: HTTP ${res.statusCode}`));
                    return;
                }
                resolve(xml);
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('GetZoneInfo timed out'));
        });
        req.write(payload);
        req.end();
    });
}
function soapGetPositionInfo(baseUrl) {
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
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 1400,
            path: url.pathname,
            method: 'POST',
            headers: {
                'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"',
                'CONTENT-LENGTH': payload.length,
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const xml = Buffer.concat(chunks).toString('utf8');
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`GetPositionInfo failed: HTTP ${res.statusCode}`));
                    return;
                }
                resolve(xml);
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('GetPositionInfo timed out'));
        });
        req.write(payload);
        req.end();
    });
}
/** Friendly now-playing text when Sonos leaves TV HDMI / line-in metadata empty. */
function nowPlayingLabels(track, labels, extra) {
    const uri = String(track.uri || '');
    const rawTitle = String(track.title || '').trim();
    const artist = String(track.artist || '').trim();
    const album = String(track.album || '').trim();
    const placeholder = isPlaceholderTitle(rawTitle);
    if (isTvStreamUri(uri)) {
        const format = tvAudioFormat(rawTitle) || tvAudioFormat(streamContentFromDidl(extra?.metadata)) || tvAudioFormat(artist);
        return {
            title: labels.tv,
            artist: format || labels.tvHdmi,
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
function getMediaRoot(services, labels, playerUuid) {
    const available = Object.keys(services || {});
    const used = new Set();
    const items = [
        mediaItem({
            id: 'tv',
            title: labels.tv,
            artist: labels.tvHdmi,
            uri: playerUuid ? tvStreamUri(playerUuid) : '',
            folder: false,
        }),
        mediaItem({ id: 'R:0', title: labels.radio, folder: true }),
    ];
    const addService = (name) => {
        const key = name.toLowerCase();
        if (used.has(key)) {
            return;
        }
        used.add(key);
        items.push(mediaItem({ id: `service:${name}`, title: name, folder: true, service: true }));
    };
    addService('Spotify');
    addService('YouTube Music');
    FEATURED_SERVICES.forEach(name => {
        const match = available.find(item => item.toLowerCase() === name.toLowerCase());
        if (match) {
            addService(match);
        }
    });
    items.push(mediaItem({ id: 'A:', title: labels.library, folder: true }), mediaItem({ id: 'S:', title: labels.shares, folder: true }), mediaItem({ id: 'AI:', title: labels.lineIn, folder: true }));
    available.sort((a, b) => a.localeCompare(b)).forEach(name => addService(name));
    return { id: 'root', title: '', items };
}
async function browseMedia(baseUrl, objectId) {
    const xml = await soapBrowse(baseUrl, objectId);
    return parseDidl(extractDidl(xml), baseUrl);
}
function isStreamUri(uri) {
    return /^(x-sonosapi-stream:|x-sonosapi-radio:|x-sonosapi-hls(?:-static)?:|x-sonosprog-http:|x-rincon-mp3radio:|x-rincon-stream:|x-sonos-htastream:|pndrradio:|aac:)/i.test(uri);
}
/** URIs that the player resolves itself (radio, SMAPI containers) — use setAVTransport, not the queue. */
function isDirectPlayUri(uri) {
    return isStreamUri(uri) || /^x-rincon-cpcontainer:/i.test(uri);
}
//# sourceMappingURL=content-directory.js.map