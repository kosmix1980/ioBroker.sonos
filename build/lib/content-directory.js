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
            folder: folder && !uri.startsWith('x-rincon-stream:'),
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
        return /youtube|sid=677\b/.test(text);
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
function getMediaRoot(services, labels) {
    const available = Object.keys(services || {});
    const used = new Set();
    const items = [mediaItem({ id: 'R:0', title: labels.radio, folder: true })];
    const addService = (name) => {
        const key = name.toLowerCase();
        if (used.has(key)) {
            return;
        }
        used.add(key);
        items.push(mediaItem({ id: `service:${name}`, title: name, folder: true, service: true }));
    };
    addService('Spotify');
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
    return /^(x-sonosapi-stream:|x-sonosapi-radio:|x-sonosapi-hls:|x-sonosprog-http:|x-rincon-mp3radio:|x-rincon-stream:|pndrradio:|aac:)/i.test(uri);
}
/** URIs that the player resolves itself (radio, SMAPI containers) — use setAVTransport, not the queue. */
function isDirectPlayUri(uri) {
    return isStreamUri(uri) || /^x-rincon-cpcontainer:/i.test(uri);
}
//# sourceMappingURL=content-directory.js.map