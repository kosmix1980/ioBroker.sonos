const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const build = path.join(__dirname, '..', 'build', 'lib', 'content-directory.js');
if (!fs.existsSync(build)) {
    execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

const cd = require(build);

const POSITION_XML = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <Track>2</Track>
      <TrackDuration>0:03:45</TrackDuration>
      <TrackMetaData>&lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"&gt;&lt;item id="-1" parentID="-1" restricted="true"&gt;&lt;res duration="0:03:45"&gt;x-sonos-spotify:spotify%3atrack%3aabc&lt;/res&gt;&lt;dc:title&gt;Song Title&lt;/dc:title&gt;&lt;dc:creator&gt;The Artist&lt;/dc:creator&gt;&lt;upnp:album&gt;The Album&lt;/upnp:album&gt;&lt;upnp:albumArtURI&gt;https://i.scdn.co/image/abc.png&lt;/upnp:albumArtURI&gt;&lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</TrackMetaData>
      <TrackURI>x-sonos-spotify:spotify%3atrack%3aabc</TrackURI>
      <RelTime>0:01:02</RelTime>
    </u:GetPositionInfoResponse>
  </s:Body>
</s:Envelope>`;

describe('content-directory playback helpers', () => {
    it('parses GetPositionInfo duration, title and cover', () => {
        const info = cd.parsePositionInfo(POSITION_XML);
        assert.equal(info.duration, 225);
        assert.equal(info.elapsed, 62);
        assert.equal(info.title, 'Song Title');
        assert.equal(info.artist, 'The Artist');
        assert.equal(info.album, 'The Album');
        assert.equal(info.cover, 'https://i.scdn.co/image/abc.png');
        assert.match(info.uri, /x-sonos-spotify:/);
        assert.match(info.metadata, /musicTrack/);
    });

    it('treats service tracks as on-demand, not radio', () => {
        assert.equal(cd.isOnDemandUri('x-sonos-spotify:spotify:track:1'), true);
        assert.equal(cd.isOnDemandUri('x-sonosprog-http:track'), true);
        assert.equal(cd.isOnDemandUri('x-rincon-queue:RINCON_ABC#0'), true);
        assert.equal(cd.isRadioLikeUri('x-sonos-spotify:spotify:track:1'), false);
        assert.equal(cd.isRadioLikeUri('x-sonosprog-http:track'), false);
        assert.equal(cd.isRadioLikeUri('x-sonosapi-stream:s1'), true);
    });

    it('builds track DIDL and does not reuse radio metadata', () => {
        const radio = cd.radioBroadcastDidl('Bayern 3');
        assert.equal(cd.isBroadcastDidl(radio), true);
        const didl = cd.trackDidl({
            title: 'Song',
            artist: 'Artist',
            album: 'Album',
            uri: 'x-sonos-http:file.mp3',
            cover: 'https://art.example/a.png',
            durationSec: 90,
            metadata: radio,
        });
        assert.equal(cd.isBroadcastDidl(didl), false);
        assert.match(didl, /musicTrack/);
        assert.match(didl, /Song/);
        assert.match(didl, /https:\/\/art\.example\/a\.png/);
    });

    it('keeps existing track DIDL', () => {
        const existing = cd.trackDidl({ title: 'Keep', uri: 'x-file-cifs://share/a.mp3' });
        const again = cd.trackDidl({ title: 'Other', metadata: existing });
        assert.equal(again, existing);
    });
});
