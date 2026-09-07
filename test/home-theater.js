const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const build = path.join(__dirname, '..', 'build', 'lib', 'home-theater.js');
if (!fs.existsSync(build)) {
    execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

const ht = require(build);

const SOAP_WOHNZIMMER = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetZoneGroupStateResponse xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1">
      <ZoneGroupState>&lt;ZoneGroups&gt;&lt;ZoneGroup Coordinator=&quot;RINCON_ARC&quot; ID=&quot;RINCON_ARC:1&quot;&gt;&lt;ZoneGroupMember UUID=&quot;RINCON_ARC&quot; Location=&quot;http://192.168.1.10:1400/xml/device_description.xml&quot; ZoneName=&quot;Wohnzimmer&quot; HTSatChanMapSet=&quot;RINCON_ARC:LF,RF;RINCON_L:LR;RINCON_R:RR&quot;&gt;&lt;Satellite UUID=&quot;RINCON_L&quot; Location=&quot;http://192.168.1.11:1400/xml/device_description.xml&quot; Invisible=&quot;1&quot;/&gt;&lt;Satellite UUID=&quot;RINCON_R&quot; Location=&quot;http://192.168.1.12:1400/xml/device_description.xml&quot; Invisible=&quot;1&quot;/&gt;&lt;/ZoneGroupMember&gt;&lt;ZoneGroupMember UUID=&quot;RINCON_KITCHEN&quot; Location=&quot;http://192.168.1.20:1400/xml/device_description.xml&quot; ZoneName=&quot;Kueche&quot;/&gt;&lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;</ZoneGroupState>
    </u:GetZoneGroupStateResponse>
  </s:Body>
</s:Envelope>`;

describe('home-theater', () => {
    it('parses HTSatChanMapSet and satellite locations from GetZoneGroupState', () => {
        const bonds = ht.parseHomeTheaterBonds(SOAP_WOHNZIMMER);
        assert.equal(bonds.length, 1);
        assert.equal(bonds[0].primaryUuid, 'RINCON_ARC');
        assert.equal(bonds[0].primaryIp, '192.168.1.10');
        assert.deepEqual(
            bonds[0].satellites.map(sat => ({ uuid: sat.uuid, ip: sat.ip, channel: sat.channel })),
            [
                { uuid: 'RINCON_L', ip: '192.168.1.11', channel: 'LR' },
                { uuid: 'RINCON_R', ip: '192.168.1.12', channel: 'RR' },
            ],
        );
    });

    it('parses the sonos-discovery satellite fixture', () => {
        const xml = fs.readFileSync(
            path.join(__dirname, '..', 'node_modules', 'sonos-discovery', 'test', 'data', 'zonegroupstate_with_satellites.xml'),
            'utf8',
        );
        const bonds = ht.parseHomeTheaterBonds(xml);
        const theatre = bonds.find(bond => bond.primaryUuid === 'RINCON_000PPP1400');
        assert.ok(theatre);
        assert.equal(theatre.primaryIp, '192.168.1.103');
        assert.equal(theatre.satellites.length, 3);
        assert.deepEqual(
            theatre.satellites.map(sat => sat.channel).sort(),
            ['LR', 'RR', 'SW'],
        );
        assert.equal(theatre.satellites.find(sat => sat.channel === 'RR').ip, '192.168.1.105');
        assert.equal(theatre.satellites.find(sat => sat.channel === 'LR').ip, '192.168.1.106');
        assert.equal(theatre.satellites.find(sat => sat.channel === 'SW').ip, '192.168.1.104');
    });

    it('keeps last-known bonds while topology briefly drops the channel map', () => {
        const cached = ht.parseHomeTheaterBonds(SOAP_WOHNZIMMER);
        const kept = ht.rememberHomeTheaterBonds(cached, [], 1_000, 1_000 + 5_000);
        assert.equal(kept.bonds.length, 1);
        const stale = ht.rememberHomeTheaterBonds(cached, [], 1_000, 1_000 + 61_000);
        assert.equal(stale.bonds.length, 0);
    });

    it('identifies satellites vs the soundbar', () => {
        const bonds = ht.parseHomeTheaterBonds(SOAP_WOHNZIMMER);
        assert.equal(ht.isHomeTheaterSatellite(bonds, 'RINCON_L'), true);
        assert.equal(ht.isHomeTheaterSatellite(bonds, '192_168_1_12'), true);
        assert.equal(ht.isHomeTheaterSatellite(bonds, 'RINCON_ARC'), false);
        assert.equal(ht.findHomeTheaterBond(bonds, '192.168.1.11').primaryUuid, 'RINCON_ARC');
    });

    it('publishes underscore channel ids for the widget', () => {
        const json = JSON.parse(ht.homeTheaterStateJson(ht.parseHomeTheaterBonds(SOAP_WOHNZIMMER)));
        assert.equal(json.bonds[0].primaryIp, '192_168_1_10');
        assert.equal(json.bonds[0].satellites[0].ip, '192_168_1_11');
    });

    it('parses a channel map without locations', () => {
        const rows = ht.parseHtChanMap('RINCON_ARC:LF,RF;RINCON_L:LR;RINCON_R:RR');
        assert.equal(rows.length, 3);
        assert.equal(rows[1].channels, 'LR');
    });
});
