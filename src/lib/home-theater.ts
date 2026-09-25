/**
 * Home-theater (soundbar + surrounds) helpers.
 * After a room group change Sonos often leaves bonded satellites muted.
 */
import * as http from 'node:http';

export interface HtSatellite {
    uuid: string;
    ip: string;
    channel: string;
}

export interface HomeTheaterBond {
    primaryUuid: string;
    primaryIp: string;
    satellites: HtSatellite[];
}

const HT_BOND_STALE_MS = 60_000;
const SOAP_TIMEOUT_MS = 5000;
const SURROUND_CHANNELS = new Set(['LR', 'RR', 'SW', 'LS', 'RS']);

function decodeXmlEntities(value: string): string {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function maybeDecode(value: string): string {
    return /&(?:lt|gt|quot|apos|amp|#39);/i.test(value) ? decodeXmlEntities(value) : value;
}

function xmlEscape(value: string): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(xml: string, name: string): string {
    const match = xml.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
    return match ? maybeDecode(match[1]) : '';
}

/** Dotted IPv4/host from a Sonos Location URL. */
export function ipFromLocation(location: string): string {
    const match = String(location || '').match(/https?:\/\/(\[[^\]]+\]|[^:/]+)/i);
    return match ? match[1] : '';
}

/** Adapter channel id (`192_168_1_10`) from a dotted or already-normalized IP. */
export function toChannelId(ip: string): string {
    return String(ip || '').replace(/[.\s]+/g, '_');
}

export function toDottedIp(ip: string): string {
    const value = String(ip || '').trim();
    if (!value) {
        return '';
    }
    if (/^https?:\/\//i.test(value)) {
        return ipFromLocation(value);
    }
    return value.includes('_') && !value.includes('.') ? value.replace(/_/g, '.') : value;
}

export function playerBaseUrl(ip: string): string {
    const host = toDottedIp(ip);
    if (!host) {
        return '';
    }
    if (/^https?:\/\//i.test(host)) {
        return host.replace(/\/$/, '');
    }
    return `http://${host}:1400`;
}

/** Inner ZoneGroupState XML, whether already decoded or still entity-escaped. */
export function extractZoneGroupXml(raw: string): string {
    const source = String(raw || '');
    const tagged = source.match(/<ZoneGroupState\b[^>]*>([\s\S]*?)<\/ZoneGroupState>/i);
    let inner = tagged ? tagged[1].trim() : source;
    if (/&lt;ZoneGroups?/i.test(inner) || /&lt;ZoneGroupMember/i.test(inner)) {
        inner = decodeXmlEntities(inner);
    }
    return inner;
}

export function parseHtChanMap(map: string): { uuid: string; channels: string }[] {
    return String(map || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const colon = part.indexOf(':');
            if (colon <= 0) {
                return null;
            }
            return { uuid: part.slice(0, colon).trim(), channels: part.slice(colon + 1).trim() };
        })
        .filter((row): row is { uuid: string; channels: string } => Boolean(row?.uuid));
}

export function parseHomeTheaterBonds(raw: string): HomeTheaterBond[] {
    const xml = extractZoneGroupXml(raw);
    const locations = new Map<string, string>();
    const members: { uuid: string; ip: string; htMap: string }[] = [];

    const tagRe = /<(ZoneGroupMember|Satellite)\b([^>]*?)(\/>|>)/gi;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(xml))) {
        const attrs = match[2];
        const uuid = attr(attrs, 'UUID');
        const ip = ipFromLocation(attr(attrs, 'Location'));
        const htMap = attr(attrs, 'HTSatChanMapSet');
        if (uuid && ip) {
            locations.set(uuid, ip);
        }
        if (uuid && htMap && match[1].toLowerCase() === 'zonegroupmember') {
            members.push({ uuid, ip, htMap });
        }
    }

    const bonds: HomeTheaterBond[] = [];
    const seen = new Set<string>();

    for (const member of members) {
        if (seen.has(member.uuid)) {
            continue;
        }
        seen.add(member.uuid);
        const satellites: HtSatellite[] = [];
        for (const entry of parseHtChanMap(member.htMap)) {
            if (entry.uuid === member.uuid) {
                continue;
            }
            satellites.push({
                uuid: entry.uuid,
                ip: locations.get(entry.uuid) || '',
                channel: entry.channels,
            });
        }
        if (!satellites.length) {
            continue;
        }
        bonds.push({
            primaryUuid: member.uuid,
            primaryIp: member.ip,
            satellites,
        });
    }

    return bonds;
}

/** Keep last-known satellites when topology briefly drops HTSatChanMapSet. */
export function rememberHomeTheaterBonds(
    cached: HomeTheaterBond[],
    fresh: HomeTheaterBond[],
    seenAt: number,
    now = Date.now(),
): { bonds: HomeTheaterBond[]; seenAt: number } {
    if (fresh.length) {
        return { bonds: fresh, seenAt: now };
    }
    if (cached.length && now - seenAt <= HT_BOND_STALE_MS) {
        return { bonds: cached, seenAt };
    }
    return { bonds: [], seenAt: fresh.length ? now : seenAt };
}

export function findHomeTheaterBond(bonds: HomeTheaterBond[], uuidOrIp: string): HomeTheaterBond | undefined {
    const key = String(uuidOrIp || '').trim();
    if (!key) {
        return undefined;
    }
    const channel = toChannelId(key);
    return bonds.find(
        bond =>
            bond.primaryUuid === key ||
            toChannelId(bond.primaryIp) === channel ||
            bond.satellites.some(sat => sat.uuid === key || toChannelId(sat.ip) === channel),
    );
}

export function isHomeTheaterSatellite(bonds: HomeTheaterBond[], uuidOrIp: string): boolean {
    const bond = findHomeTheaterBond(bonds, uuidOrIp);
    if (!bond) {
        return false;
    }
    const key = String(uuidOrIp || '').trim();
    const channel = toChannelId(key);
    return bond.satellites.some(sat => sat.uuid === key || toChannelId(sat.ip) === channel);
}

export function homeTheaterStateJson(bonds: HomeTheaterBond[]): string {
    return JSON.stringify({
        bonds: bonds.map(bond => ({
            primaryIp: toChannelId(bond.primaryIp),
            primaryUuid: bond.primaryUuid,
            satellites: bond.satellites.map(sat => ({
                ip: toChannelId(sat.ip),
                uuid: sat.uuid,
                channel: sat.channel,
            })),
        })),
    });
}

function soapEnvelope(action: string, urn: string, inner: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${urn}">${inner}</u:${action}>
  </s:Body>
</s:Envelope>`;
}

function soapPost(baseUrl: string, controlPath: string, urn: string, action: string, inner: string): Promise<string> {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}${controlPath}`);
    const payload = Buffer.from(soapEnvelope(action, urn, inner), 'utf8');

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 1400,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'CONTENT-TYPE': 'text/xml; charset="utf-8"',
                    SOAPACTION: `"${urn}#${action}"`,
                    'CONTENT-LENGTH': payload.length,
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const xml = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`${action} failed: HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(xml);
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(SOAP_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error(`${action} timed out`));
        });
        req.write(payload);
        req.end();
    });
}

export function soapGetZoneGroupState(baseUrl: string): Promise<string> {
    return soapPost(
        baseUrl,
        '/ZoneGroupTopology/Control',
        'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
        'GetZoneGroupState',
        '',
    );
}

export function soapSetMute(baseUrl: string, muted: boolean, channel = 'Master'): Promise<string> {
    return soapPost(
        baseUrl,
        '/MediaRenderer/RenderingControl/Control',
        'urn:schemas-upnp-org:service:RenderingControl:1',
        'SetMute',
        `<InstanceID>0</InstanceID><Channel>${xmlEscape(channel)}</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute>`,
    );
}

export function soapGetMute(baseUrl: string, channel = 'Master'): Promise<boolean> {
    return soapPost(
        baseUrl,
        '/MediaRenderer/RenderingControl/Control',
        'urn:schemas-upnp-org:service:RenderingControl:1',
        'GetMute',
        `<InstanceID>0</InstanceID><Channel>${xmlEscape(channel)}</Channel>`,
    ).then(xml => {
        const match = xml.match(/<CurrentMute>([^<]*)<\/CurrentMute>/i);
        return Boolean(match && match[1].trim() === '1');
    });
}

export function soapSetEq(baseUrl: string, eqType: string, value: number): Promise<string> {
    return soapPost(
        baseUrl,
        '/MediaRenderer/RenderingControl/Control',
        'urn:schemas-upnp-org:service:RenderingControl:1',
        'SetEQ',
        `<InstanceID>0</InstanceID><EQType>${xmlEscape(eqType)}</EQType><DesiredValue>${value}</DesiredValue>`,
    );
}

function surroundChannelsFor(bond: HomeTheaterBond): string[] {
    const channels = new Set<string>(['LR', 'RR', 'SW']);
    for (const sat of bond.satellites) {
        for (const part of sat.channel.split(',')) {
            const name = part.trim().toUpperCase();
            if (SURROUND_CHANNELS.has(name)) {
                channels.add(name);
            }
        }
    }
    return [...channels];
}

/**
 * Unmute bonded surrounds. Leaves the soundbar Master mute alone so a muted
 * living-room stays muted.
 */
export async function unmuteHomeTheaterBond(bond: HomeTheaterBond): Promise<void> {
    const primaryUrl = playerBaseUrl(bond.primaryIp);
    if (!primaryUrl) {
        return;
    }

    let roomMuted = false;
    try {
        roomMuted = await soapGetMute(primaryUrl, 'Master');
    } catch {
        roomMuted = false;
    }
    if (roomMuted) {
        return;
    }

    const jobs: Promise<unknown>[] = surroundChannelsFor(bond).map(channel =>
        soapSetMute(primaryUrl, false, channel).catch(() => undefined),
    );
    jobs.push(soapSetEq(primaryUrl, 'SurroundEnable', 1).catch(() => undefined));
    for (const sat of bond.satellites) {
        const satUrl = playerBaseUrl(sat.ip);
        if (!satUrl || satUrl === primaryUrl) {
            continue;
        }
        jobs.push(soapSetMute(satUrl, false, 'Master').catch(() => undefined));
    }
    await Promise.all(jobs);
}
