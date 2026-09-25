'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { expect } = require('chai');

const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('www instance-link GUI', () => {
    it('ships the page, widget copy, jQuery and icon', () => {
        [
            'www/index.html',
            'www/manifest.json',
            'www/css/app.css',
            'www/css/style.css',
            'www/js/app.js',
            'www/js/conn.js',
            'www/js/sonos-widget.js',
            'www/js/jquery.min.js',
            'www/sonos.png',
        ].forEach(rel => {
            assert.ok(fs.existsSync(path.join(root, rel)), rel);
        });
        expect(read('www/js/jquery.min.js')).to.match(/jQuery v3/);
        expect(read('www/js/sonos-widget.js')).to.include('vis.binds.sonos');
    });

    it('registers an instance link to /sonos/', () => {
        const io = JSON.parse(read('io-package.json'));
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.files).to.include('www/');
        expect(io.common.restartAdapters).to.include('web');
        expect(io.common.localLink).to.include('/sonos/index.html');
        expect(io.common.localLinks._default.link).to.include('/sonos/index.html');
        expect(io.common.localLinks._default.link).to.include('%instance%');
    });

    it('loads the vis shim without a browser', () => {
        const sandbox = {
            navigator: { language: 'de' },
            document: {
                createElement() {
                    return {};
                },
                head: { appendChild() {} },
            },
        };
        sandbox.window = sandbox;
        vm.runInNewContext(read('www/js/conn.js'), sandbox);
        expect(sandbox.vis.language).to.equal('de');
        expect(sandbox.vis.conn.getStates).to.be.a('function');
        expect(sandbox.vis.setValue).to.be.a('function');
        expect(sandbox.SonosWww.loadInstances).to.be.a('function');
        sandbox.vis.setValue('sonos.0.root.x.state', 'play');
        sandbox.vis.states['sonos.0.root.x.volume.val'] = 12;
        let fired = 0;
        sandbox.vis.states.bind('sonos.0.root.x.volume.val', () => {
            fired += 1;
        });
        sandbox.SonosWww.applyStates({
            'sonos.0.root.x.volume': { val: 20, ack: true, ts: 1 },
        });
        expect(sandbox.vis.states['sonos.0.root.x.volume.val']).to.equal(20);
        expect(fired).to.equal(1);
    });
});
