/**
 * Browse Sonos ContentDirectory (TuneIn, music library, network shares, line-in).
 * Music services such as YouTube Music are listed by name only; their catalogs
 * need SMAPI, which sonos-discovery does not expose.
 */
import * as http from 'node:http';

export interface MediaBrowseItem {
    id: string;
    title: string;
    uri: string;
    metadata: string;
    artist: string;
    album: string;
    cover: string;
    folder: boolean;
    service?: boolean;
}

export interface MediaBrowseResult {
    id: string;
    title: string;
    items: MediaBrowseItem[];
}

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

function soapBrowse(baseUrl: string, objectId: string): Promise<string> {
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

export function getMediaRoot(
    services: Record<string, unknown> | undefined,
    labels: { radio: string; library: string; shares: string; lineIn: string },
): MediaBrowseResult {
    const items: MediaBrowseItem[] = [
        { id: 'R:0', title: labels.radio, uri: '', metadata: '', artist: '', album: '', cover: '', folder: true },
        { id: 'A:', title: labels.library, uri: '', metadata: '', artist: '', album: '', cover: '', folder: true },
        { id: 'S:', title: labels.shares, uri: '', metadata: '', artist: '', album: '', cover: '', folder: true },
        { id: 'AI:', title: labels.lineIn, uri: '', metadata: '', artist: '', album: '', cover: '', folder: true },
    ];

    Object.keys(services || {})
        .sort((a, b) => a.localeCompare(b))
        .forEach(name => {
            items.push({
                id: `service:${name}`,
                title: name,
                uri: '',
                metadata: '',
                artist: '',
                album: '',
                cover: '',
                folder: false,
                service: true,
            });
        });

    return { id: 'root', title: '', items };
}

export async function browseMedia(baseUrl: string, objectId: string): Promise<MediaBrowseItem[]> {
    const xml = await soapBrowse(baseUrl, objectId);
    return parseDidl(extractDidl(xml), baseUrl);
}

export function isStreamUri(uri: string): boolean {
    return /^(x-sonosapi-stream:|x-sonosapi-radio:|x-sonosapi-hls:|x-sonosprog-http:|x-rincon-mp3radio:|x-rincon-stream:|pndrradio:|aac:)/i.test(
        uri,
    );
}
