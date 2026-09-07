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
/**
 *      ioBroker Sonos Adapter
 *      Copyright (c) 12'2013-2026 Bluefox <dogafox@gmail.com>
 *      MIT License
 *
 *      derived from https://github.com/jishi/node-sonos-web-controller by Jimmy Shimizu
 */
const fs = __importStar(require("node:fs"));
const http = __importStar(require("node:http"));
const crypto = __importStar(require("node:crypto"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const utils = __importStar(require("@iobroker/adapter-core"));
const discovery_backend_1 = require("./lib/backend/discovery-backend");
const svrooij_backend_1 = require("./lib/backend/svrooij-backend");
const tts_1 = require("./lib/tts");
const states_1 = require("./lib/states");
const content_directory_1 = require("./lib/content-directory");
const smapi_1 = require("./lib/smapi");
const quickstart_1 = require("./lib/quickstart");
const home_theater_1 = require("./lib/home-theater");
const ytmusic_1 = require("./lib/ytmusic");
const DEFAULT_IMAGE = `${__dirname}/../img/no-cover.png`;
const TV_IMAGE = `${__dirname}/../img/tv-cover.png`;
const RECENT_TRACKS_MAX = 25;
/** How often the HDMI audio format is re-read while the TV input is playing */
const TV_FORMAT_POLL_MS = 5000;
/** Debounce for {@link Sonos.resolveTvFormat}, so an event burst does not hit the speaker repeatedly */
const TV_FORMAT_CACHE_MS = 2000;
/** Grouping URI used when a player is a slave (`x-rincon:RINCON_...`) */
function isGroupingUri(uri) {
    return /^x-rincon:RINCON_/i.test(String(uri || ''));
}
/** HDMI / line-in start with SetAVTransportURI. Play/Pause/Seek return HTTP 500. */
const TV_NO_TRANSPORT = new Set([
    'play',
    'pause',
    'stop',
    'next',
    'prev',
    'seek',
    'current_elapsed',
    'current_elapsed_s',
    'current_track_number',
    'shuffle',
    'repeat',
    'crossfade',
    'state_simple',
]);
/**
 * Convert seconds into "[h:]mm:ss"
 *
 * @param time time in seconds
 */
function toFormattedTime(time) {
    const hours = Math.floor(time / 3600);
    const min = Math.floor(time / 60) % 60;
    const sec = time % 60;
    return `${hours ? `${hours}:` : ''}${min < 10 ? `0${min}` : min}:${sec < 10 ? `0${sec}` : sec}`;
}
/**
 * Find the ID of an enum (room) by its name
 *
 * @param enums rows of the enum object view
 * @param name name of the room, reported by sonos
 */
function enumName2Id(enums, name) {
    name = name.toLowerCase();
    for (let e = 0; e < enums.length; e++) {
        const common = enums[e]?.value?.common;
        if (common?.name) {
            if (typeof common.name === 'object') {
                for (const lang in common.name) {
                    if (common.name[lang]?.toLowerCase() === name) {
                        return enums[e].id;
                    }
                }
            }
            else if (common.name.toLowerCase() === name) {
                return enums[e].id;
            }
        }
        // very old enums have the name directly in the object
        const legacyName = enums[e]?.value?.name;
        if (legacyName) {
            if (typeof legacyName === 'object') {
                for (const lang in legacyName) {
                    if (legacyName[lang]?.toLowerCase() === name) {
                        return enums[e].id;
                    }
                }
            }
            else if (legacyName.toLowerCase() === name) {
                return enums[e].id;
            }
        }
    }
    return '';
}
/**
 * Convert the sonos playback state into flags
 *
 * @param playbackState playback state, reported by sonos
 */
function getPlaybackState(playbackState) {
    return {
        playing: playbackState === 'PLAYING',
        paused: playbackState === 'PAUSED_PLAYBACK',
        transitioning: playbackState === 'TRANSITIONING',
        stopped: playbackState === 'STOPPED',
    };
}
class Sonos extends utils.Adapter {
    /** IDs of all "alive" states, that must be set to false by unload */
    aliveIds = [];
    /** True after playlists were loaded at least once */
    playlistsLoaded = false;
    /** All known devices with the IP address (dots replaced by underscores) as key */
    channels = {};
    backend = null;
    lastCover = {};
    /** Per-image cover URL for recent/history (not the shared live current_cover path). */
    lastStableCover = {};
    lastTvFormat = {};
    lastTvFormatFetch = {};
    /** Last value written to `current_artist` while on the TV input, keyed by channel */
    lastTvFormatWritten = {};
    lastHistoryKey = {};
    cacheDir = '';
    currentFileNum = 0;
    queues = {};
    /** Running announcement per device uuid. It used to be attached to the player object itself. */
    tts = {};
    /** Last HTSatChanMapSet bonds (Arc + surrounds). Kept briefly if topology drops the map. */
    htBonds = [];
    htBondsSeenAt = 0;
    htHealTimer = null;
    htHealRetryTimer = null;
    htRefreshTimer = null;
    lastPlaybackHint = {};
    /** Skip identical VIS-bound writes so the widget does not rebuild on every poll. */
    lastWrittenVal = {};
    writeCacheKey(id) {
        if (typeof id === 'string') {
            return id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        }
        return [id.device, id.channel, id.state].filter(Boolean).join('.');
    }
    async writeIfChanged(id, val, ack = true) {
        const key = this.writeCacheKey(id);
        const serialized = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (this.lastWrittenVal[key] === serialized) {
            return;
        }
        this.lastWrittenVal[key] = serialized;
        if (typeof id === 'string') {
            await this.setState(id, { val, ack });
            return;
        }
        await this.setState(id, { val, ack });
    }
    isSharedLiveCover(cover) {
        return /(?:^|\/)coverImage\/(?!art\/)[^/?#]+\.png(?:\?|#|$)/i.test(String(cover || ''));
    }
    constructor(options = {}) {
        super({
            ...options,
            name: 'sonos',
            error: (err) => {
                // Identify unhandled errors originating from callbacks in scripts
                // These are not caught by wrapping the execution code in try-catch
                if (err) {
                    const errStr = err.toString();
                    if (errStr.includes('EHOSTUNREACH') ||
                        errStr.includes('ECONNRESET') ||
                        errStr.includes('EAI_AGAIN')) {
                        return true;
                    }
                }
                return false;
            },
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    async onReady() {
        try {
            await this.clearLegacyBinaryStates();
        }
        catch (e) {
            this.log.warn(`Could not clear legacy binary states: ${e.message}`);
        }
        // the "root" device object is created by js-controller from "instanceObjects" in io-package.json
        await this.main();
    }
    onUnload(callback) {
        try {
            this.aliveIds.forEach(id => this.setState(id, false, true));
            Object.keys(this.channels).forEach(ip => {
                if (this.channels[ip]?.elapsedTimer) {
                    clearInterval(this.channels[ip].elapsedTimer);
                    this.channels[ip].elapsedTimer = null;
                }
                if (this.channels[ip]?.tvFormatTimer) {
                    clearInterval(this.channels[ip].tvFormatTimer);
                    this.channels[ip].tvFormatTimer = null;
                }
                if (this.channels[ip]?.timerVolume) {
                    clearTimeout(this.channels[ip].timerVolume);
                    this.channels[ip].timerVolume = null;
                }
            });
            if (this.htHealTimer) {
                clearTimeout(this.htHealTimer);
                this.htHealTimer = null;
            }
            if (this.htHealRetryTimer) {
                clearTimeout(this.htHealRetryTimer);
                this.htHealRetryTimer = null;
            }
            if (this.htRefreshTimer) {
                clearTimeout(this.htRefreshTimer);
                this.htRefreshTimer = null;
            }
            this.log.info('terminating');
            if (this.backend) {
                Object.keys(this.tts).forEach(uuid => {
                    this.tts[uuid].destroy();
                    delete this.tts[uuid];
                });
                this.backend.dispose();
                this.backend = null;
            }
            callback();
        }
        catch {
            callback();
        }
    }
    // id = sonos.0.192_168_1_55.state
    onStateChange(_id, state) {
        if (!state || state.ack) {
            return;
        }
        if (_id === `${this.namespace}.quickstarts`) {
            void this.stabilizeQuickstartCovers(String(state.val || ''));
            return;
        }
        this.log.info(`try to control id ${_id} with ${JSON.stringify(state)}`);
        // Try to find the object
        const id = this.idToDCS(_id);
        if (!id?.channel || !this.channels[id.channel]) {
            return;
        }
        let value = state.val;
        if (value === 'false') {
            value = false;
        }
        if (value === 'true') {
            value = true;
        }
        if (parseInt(value) === value) {
            value = parseInt(value);
        }
        let player = this.channels[id.channel].player;
        if (!player) {
            player = this.backend?.getDeviceByUuid(this.channels[id.channel].uuid) || null;
            this.channels[id.channel].player = player;
        }
        if (!player) {
            this.log.warn(`SONOS "${id.channel}"/"${this.channels[id.channel].uuid}" not found`);
            this.backend?.devices.forEach(p => this.log.debug(`UUID: ${p.uuid} in ${p.roomName} / ${p.baseUrl}`));
            return;
        }
        // Only grouped members send transport to the master. A standalone room
        // (or the group coordinator itself) always controls its own playback.
        const media = player.coordinator;
        const mediaIp = media.channel || id.channel;
        const onTv = (0, content_directory_1.isTvStreamUri)(media.transportUri) || (0, content_directory_1.isTvStreamUri)(player.transportUri);
        if (onTv && TV_NO_TRANSPORT.has(id.state)) {
            this.log.warn(`Ignored "${id.state}" on ${id.channel}: the TV input has no transport control`);
            return;
        }
        if (onTv && id.state === 'state') {
            const action = String(value || '').toLowerCase();
            if (['play', 'pause', 'stop', 'next', 'previous'].includes(action)) {
                this.log.warn(`Ignored state="${action}" on ${id.channel}: the TV input has no transport control`);
                return;
            }
        }
        let promise;
        if (id.state === 'state_simple') {
            promise = value ? media.play() : media.pause();
        }
        else if (id.state === 'current_track_number') {
            promise = media.seekTrack(value);
        }
        else if (id.state === 'shuffle') {
            promise = media.setShuffle(!!value);
        }
        else if (id.state === 'crossfade') {
            promise = media.setCrossfade(!!value);
        }
        else if (id.state === 'repeat') {
            if (value === 0 || value === '0') {
                promise = media.setRepeat('none');
            }
            else if (value === 1 || value === '1') {
                promise = media.setRepeat('all');
            }
            else if (value === 2 || value === '2') {
                promise = media.setRepeat('one');
            }
            else {
                promise = media.setRepeat(value);
            }
        }
        else if (id.state === 'play') {
            if (value) {
                promise = media.play();
            }
        }
        else if (id.state === 'stop') {
            if (value) {
                promise = media.pause();
            }
        }
        else if (id.state === 'pause') {
            if (value) {
                promise = media.pause();
            }
        }
        else if (id.state === 'next') {
            if (value) {
                promise = media.next();
            }
        }
        else if (id.state === 'prev') {
            if (value) {
                promise = media.previous();
            }
        }
        else if (id.state === 'seek') {
            let percent = parseFloat(value);
            if (percent < 0) {
                percent = 0;
            }
            if (percent > 100) {
                percent = 100;
            }
            const duration = this.channels[mediaIp]?.duration || this.channels[id.channel].duration;
            promise = media.seekTime(Math.round((duration * percent) / 100));
        }
        else if (id.state === 'current_elapsed') {
            promise = media.seekTime(parseInt(value, 10));
        }
        else if (id.state === 'current_elapsed_s') {
            const parts = value.toString().split(':');
            let seconds;
            if (parts.length === 3) {
                seconds = parseInt(parts[0]) * 3600;
                seconds += parseInt(parts[1]) * 60;
                seconds = parseInt(parts[2]);
            }
            else if (parts.length === 2) {
                seconds = parseInt(parts[0]) * 60;
                seconds += parseInt(parts[1]);
            }
            else if (parts.length === 1) {
                seconds = parseInt(parts[0]);
            }
            else {
                this.log.error(`Invalid elapsed time: ${value}`);
                return;
            }
            promise = media.seekTime(seconds);
        }
        else if (id.state === 'muted') {
            promise = player.setMute(!!value);
        }
        else if (id.state === 'volume') {
            promise = player.setVolume(value);
        }
        else if (id.state === 'treble') {
            promise = player.setTreble(value);
        }
        else if (id.state === 'bass') {
            promise = player.setBass(value);
        }
        else if (id.state === 'night_mode') {
            promise = player.setNightMode(!!value);
        }
        else if (id.state === 'speech_enhancement') {
            promise = player.setSpeechEnhancement(!!value);
        }
        else if (id.state === 'state') {
            // stop, play, pause, next, previous, mute, unmute
            if (value && typeof value === 'string') {
                switch (value.toLowerCase()) {
                    case 'stop':
                        promise = media.pause();
                        break;
                    case 'play':
                        promise = media.play();
                        break;
                    case 'pause':
                        promise = media.pause();
                        break;
                    case 'next':
                        promise = media.next();
                        break;
                    case 'previous':
                        promise = media.previous();
                        break;
                    case 'mute':
                        promise = player.setMute(true);
                        break;
                    case 'unmute':
                        promise = player.setMute(false);
                        break;
                    default:
                        this.log.warn(`Unknown state: ${value}`);
                        break;
                }
            }
            else {
                this.log.warn(`Invalid state: ${value}`);
            }
        }
        else if (id.state === 'favorites_set') {
            const favorite = (value || '').toString().trim();
            if (!favorite) {
                this.log.warn('favorites_set called without valid favorite name - ignored');
            }
            else {
                promise = media
                    .playFavorite(favorite)
                    .then(async () => {
                    await this.setState({ device: 'root', channel: mediaIp, state: 'current_album' }, { val: favorite, ack: true });
                    await this.setState({ device: 'root', channel: mediaIp, state: 'current_artist' }, { val: favorite, ack: true });
                })
                    .catch(error => this.log.error(`Cannot replaceWithFavorite: ${error}`));
            }
        }
        else if (id.state === 'playlist_set') {
            const playlist = (value || '').toString().trim();
            if (!playlist) {
                this.log.warn('playlist_set called without valid playlist name - ignored');
            }
            else {
                promise = media
                    .playPlaylist(playlist)
                    .then(async () => {
                    await this.setState({ device: 'root', channel: mediaIp, state: 'current_album' }, { val: playlist, ack: true });
                    await this.setState({ device: 'root', channel: mediaIp, state: 'current_artist' }, { val: playlist, ack: true });
                })
                    .catch(error => this.log.error(`Cannot replaceWithPlaylist: ${error}`));
            }
        }
        else if (id.state === 'tts') {
            this.log.debug(`Play TTS file ${value} on ${id.channel}`);
            void this.text2speech(value, id.channel);
        }
        else if (id.state === 'add_to_group') {
            promise = this.addToGroup(value, media);
        }
        else if (id.state === 'remove_from_group') {
            promise = this.removeFromGroup(value, media);
        }
        else if (id.state === 'coordinator') {
            if (value === id.channel) {
                promise = player.leaveGroup();
            }
            else {
                const coordinator = this.getPlayerByName(value);
                promise = coordinator
                    ? player.setTransportUri(`x-rincon:${coordinator.uuid}`)
                    : Promise.reject(new Error(`Player "${value}" not found`));
            }
        }
        else if (id.state === 'group_volume') {
            try {
                promise = media.setGroupVolume(value);
            }
            catch (err) {
                this.log.warn(`Cannot set group volume: ${err}`);
            }
        }
        else if (id.state === 'group_muted') {
            promise = media.setGroupMute(!!value);
        }
        else if (id.state === 'play_uri') {
            const uri = String(value || '').trim();
            if (uri && !isGroupingUri(uri)) {
                promise = this.startAvTransport(media, uri);
            }
        }
        else if (id.state === 'media_browse') {
            promise = this.handleMediaBrowse(media, mediaIp, String(value || ''), player);
        }
        else if (id.state === 'media_play') {
            promise = this.handleMediaPlay(media, String(value || ''), player);
        }
        else {
            this.log.warn(`try to control unknown id ${JSON.stringify(id)}`);
        }
        promise
            ?.then(() => this.log.debug(`command done: ${id.state} on ${id.channel}`))
            .catch(e => this.log.error(`Cannot execute command ${id.state} on ${id.channel}: ${e}`));
    }
    // New message arrived. obj is array with current messages
    onMessage(obj) {
        if (!obj) {
            return;
        }
        let wait = false;
        switch (obj.command) {
            case 'send':
                if (obj.message) {
                    void this.text2speech(obj.message);
                }
                break;
            case 'browse':
                if (obj.callback) {
                    wait = true;
                    this.browseDevices(obj).catch(e => this.log.error(`Cannot browse: ${e}`));
                }
                break;
            case 'quickstartGet':
                if (obj.callback) {
                    wait = true;
                    this.sendQuickstarts(obj).catch(e => this.log.error(`Cannot load quickstarts: ${e}`));
                }
                break;
            case 'sonos:getRooms':
                if (obj.callback) {
                    // Used by the ioBroker.devices widgets to fill their room picker. The shape
                    // `{ value, label }` is what the json-config `selectSendTo` control expects.
                    // `value` is the channel name (the IP with underscores), because every state
                    // of a player lives under `sonos.<instance>.root.<value>`.
                    this.sendTo(obj.from, obj.command, this.getRoomList(), obj.callback);
                    wait = true;
                }
                break;
            default:
                this.log.warn(`Unknown command: ${obj.command}`);
                break;
        }
        if (!wait && obj.callback) {
            this.sendTo(obj.from, obj.command, obj.message, obj.callback);
        }
    }
    /**
     * The configured players as `{ value, label }` pairs.
     *
     * `value` is the channel name - the IP address with the dots replaced by underscores, which
     * is how the adapter names the channels under `root`. `label` is the configured name, falling
     * back to the IP address, exactly like the `common.name` of the channel object.
     */
    getRoomList() {
        return (this.config.devices || [])
            .filter(device => device.ip)
            .map(device => ({
            value: device.ip.replace(/[.\s]+/g, '_'),
            label: device.name?.trim() || device.ip,
        }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
    /** Merge the devices, found by the discovery, into the configured devices and answer the message */
    async browseDevices(obj) {
        const list = this.browse();
        // get all rooms
        const rooms = await this.getObjectViewAsync('system', 'enum', {
            startkey: 'enum.rooms.',
            endkey: 'enum.rooms.香',
        });
        // merge data together
        let message = { devices: [] };
        if (obj.message) {
            if (typeof obj.message === 'object') {
                message = obj.message;
            }
            else {
                try {
                    message = JSON.parse(obj.message);
                }
                catch {
                    // ignore
                    message = { devices: [] };
                }
            }
        }
        const devices = message.devices || [];
        // merge devices
        list.forEach(item => {
            if (item.ip && !devices.find(it => it.ip === item.ip)) {
                devices.push({
                    name: item.roomName,
                    room: enumName2Id(rooms.rows, item.roomName),
                    ip: item.ip,
                });
            }
        });
        this.sendTo(obj.from, obj.command, { native: { devices } }, obj.callback);
    }
    async sendQuickstarts(obj) {
        const current = await this.getStateAsync('quickstarts');
        this.sendTo(obj.from, obj.command, { native: { quickstarts: (0, quickstart_1.parseQuickstarts)(current?.val) } }, obj.callback);
    }
    /** Instance state `quickstarts` is the runtime source. Non-empty Admin config overwrites it after save. */
    async ensureQuickstarts() {
        await this.setObjectNotExistsAsync('quickstarts', {
            type: 'state',
            common: {
                name: 'Quick start buttons',
                type: 'string',
                role: 'json',
                read: true,
                write: true,
                desc: 'JSON array of 8 VIS quick-start slots',
            },
            native: {},
        });
        const fromNative = (0, quickstart_1.parseQuickstarts)(this.config.quickstarts);
        const current = await this.getStateAsync('quickstarts');
        const fromState = (0, quickstart_1.parseQuickstarts)(current?.val);
        const slots = (0, quickstart_1.anySlotFilled)(fromNative)
            ? fromNative.map((slot, index) => {
                const prev = fromState[index];
                if (prev && slot.uri && slot.uri === prev.uri) {
                    return {
                        ...slot,
                        metadata: slot.metadata || prev.metadata,
                        cover: slot.cover || prev.cover,
                        album: slot.album || prev.album,
                        station: slot.station || prev.station,
                    };
                }
                return slot;
            })
            : fromState;
        await this.setStateAsync('quickstarts', JSON.stringify(slots), true);
        await this.stabilizeQuickstartCovers();
    }
    /** Live now-playing covers would make every shortcut show the same image. */
    async stabilizeQuickstartCovers(raw) {
        const current = raw !== undefined ? raw : String((await this.getStateAsync('quickstarts'))?.val || '');
        const slots = (0, quickstart_1.parseQuickstarts)(current);
        let changed = false;
        const next = slots.map(slot => {
            if (!this.isSharedLiveCover(slot.cover)) {
                return slot;
            }
            changed = true;
            return { ...slot, cover: '' };
        });
        if (changed) {
            await this.setStateAsync('quickstarts', JSON.stringify(next), true);
        }
    }
    /** Get all devices, that are currently known by the discovery */
    browse() {
        const result = [];
        this.backend?.devices.forEach(player => result.push({
            roomName: player.roomName,
            ip: player.ip,
        }));
        return result;
    }
    /** Clear legacy binary states, as we migrated to files */
    async clearLegacyBinaryStates() {
        const coverStates = await this.getStatesAsync('*.cover_png');
        const ttsStates = await this.getStatesAsync('TTS.tts*');
        for (const id of [...Object.keys(coverStates), ...Object.keys(ttsStates)]) {
            await this.delObjectAsync(id);
        }
    }
    async createSonosChannel(name, ip, room) {
        const states = (0, states_1.getChannelStates)();
        const id = ip.replace(/[.\s]+/g, '_');
        const obj = await this.createChannelAsync('root', id, {
            role: 'media.music',
            name: name || ip,
        }, {
            ip,
        });
        if (room) {
            await this.addChannelToEnumAsync('room', room, 'root', id);
        }
        for (const state of Object.keys(states)) {
            await this.createStateAsync('root', id, state, states[state]);
        }
        return obj;
    }
    /**
     * Create the states of a channel, that do not exist: e.g. if they were deleted manually
     * or if they were added in a newer version of the adapter
     *
     * @param id ID of the channel (IP address with underscores)
     */
    async checkChannelStates(id) {
        let existingStates;
        try {
            existingStates = await this.getStatesOfAsync('root', id);
        }
        catch (err) {
            this.log.error(`Cannot read states of root.${id}: ${err.message}`);
            return;
        }
        const prefix = `${this.namespace}.root.${id}.`;
        const existingIds = (existingStates || []).map(obj => obj._id.substring(prefix.length));
        const states = (0, states_1.getChannelStates)();
        const missingIds = Object.keys(states).filter(state => !existingIds.includes(state));
        if (missingIds.length) {
            this.log.info(`Create missing states of root.${id}: ${missingIds.join(', ')}`);
            for (const state of missingIds) {
                await this.createStateAsync('root', id, state, states[state]);
            }
        }
    }
    async syncConfig() {
        this.channels = {};
        const devices = await this.getDevicesAsync();
        this.log.debug(`Initialize known devices: ${JSON.stringify(devices)}`);
        if (!devices?.length) {
            for (const device of this.config.devices || []) {
                if (!device.ip) {
                    continue;
                }
                const obj = await this.createSonosChannel(device.name, device.ip, device.room);
                const _obj = await this.getObjectAsync(obj.id);
                if (_obj) {
                    this.channels[_obj.native.ip.replace(/[.\s]+/g, '_')] = {
                        uuid: '',
                        player: null,
                        duration: 0,
                        elapsed: 0,
                        obj: _obj,
                    };
                }
            }
            return;
        }
        // Go through all devices
        for (const device of devices) {
            const _channels = await this.getChannelsOfAsync(device.common.name);
            const configToDelete = [];
            const configToAdd = (this.config.devices || []).map(item => item.ip);
            if (_channels) {
                this.log.debug(`Channels of ${device.common.name}: ${JSON.stringify(_channels)}`);
                for (const channel of _channels) {
                    this.log.debug(`Process channel: ${channel._id}`);
                    const ip = channel.native.ip;
                    const id = ip.replace(/[.\s]+/g, '_');
                    const pos = configToAdd.indexOf(ip);
                    if (pos === -1) {
                        configToDelete.push(ip);
                        continue;
                    }
                    // the channel exists, but some of its states could be missing
                    await this.checkChannelStates(id);
                    configToAdd.splice(pos, 1);
                    // Check name and room
                    for (const configDevice of this.config.devices || []) {
                        if (configDevice.ip !== ip) {
                            continue;
                        }
                        if (channel.common.name !== (configDevice.name || configDevice.ip)) {
                            await this.extendObjectAsync(channel._id, {
                                common: {
                                    name: configDevice.name || configDevice.ip,
                                },
                                type: 'channel',
                            });
                        }
                        if (configDevice.room) {
                            // BF 2021.12.20: there is an error in js-controller 3.3
                            this.addChannelToEnum('room', configDevice.room, 'root', id);
                            // When js-controller 4.x will be common, replace it with
                            // await this.addChannelToEnumAsync('room', configDevice.room, 'root', id);
                        }
                        else {
                            try {
                                await this.deleteChannelFromEnumAsync('room', 'root', id);
                            }
                            catch (err) {
                                this.log.error(`Cannot delete channel from enum: ${err.message}`);
                            }
                        }
                    }
                    this.channels[id] = {
                        uuid: '',
                        player: null,
                        duration: 0,
                        elapsed: 0,
                        obj: channel,
                    };
                    await this.setState(`root.${id}.alive`, false, true);
                    this.aliveIds.push(`root.${id}.alive`);
                }
            }
            for (const configDevice of this.config.devices || []) {
                if (configDevice.ip && configToAdd.includes(configDevice.ip)) {
                    const obj = await this.createSonosChannel(configDevice.name, configDevice.ip, configDevice.room);
                    const _obj = await this.getObjectAsync(obj.id);
                    if (_obj) {
                        const sId = _obj.native.ip.replace(/[.\s]+/g, '_');
                        this.aliveIds.push(`root.${sId}.alive`);
                        this.channels[sId] = {
                            uuid: '',
                            player: null,
                            duration: 0,
                            elapsed: 0,
                            obj: _obj,
                        };
                    }
                }
            }
            for (const ip of configToDelete) {
                if (ip) {
                    const _id = ip.replace(/[.\s]+/g, '_');
                    await this.deleteChannelFromEnumAsync('room', 'root', _id);
                    await this.deleteChannelAsync('root', _id);
                }
            }
        }
    }
    async text2speech(fileName, sonosIp) {
        // Extract volume
        let volume = null;
        fileName = String(fileName ?? '');
        const pos = fileName.indexOf(';');
        if (pos !== -1) {
            volume = fileName.substring(0, pos);
            fileName = fileName.substring(pos + 1);
        }
        fileName = fileName.trim();
        if (sonosIp) {
            sonosIp = sonosIp.replace(/[.\s]+/g, '_');
        }
        if (!fileName) {
            // an empty value stops the running announcement
            this.log.debug('Stop TTS');
            this.stopTTS(sonosIp);
            return;
        }
        // play http/https urls directly on sonos device
        if (fileName.match(/^https?:\/\//)) {
            this.playOnAllPlayers(fileName, sonosIp, volume);
            return;
        }
        if (!this.config.webServer) {
            this.log.warn('Web server must be enabled to play local TTS files');
            return;
        }
        const parts = fileName.split('.');
        const dest = `tts${this.currentFileNum++}.${parts.pop()}`;
        if (this.currentFileNum > 10) {
            this.currentFileNum = 0;
        }
        const id = `/TTS/${this.namespace}/${dest}`;
        // Upload this file to objects DB
        try {
            const data = fs.readFileSync(fileName);
            await this.writeFileAsync(this.name, id, data);
            const obj = await this.getForeignObjectAsync(this.config.webServer);
            if (obj?.native && this.backend) {
                const url = `http${obj.native.secure ? 's' : ''}://${this.backend.localEndpoint}:${obj.native.port}/files/${this.name}${id}`;
                this.playOnAllPlayers(url, sonosIp, volume);
            }
        }
        catch (e) {
            this.log.error(`Cannot play ${fileName}: ${e.message || e}`);
        }
    }
    /**
     * Execute a callback for one specific player or for all players
     *
     * @param sonosIp IP address (with underscores) of one player or undefined for all players
     * @param callback function, that will be called for every matching player
     */
    forEachPlayer(sonosIp, callback) {
        if (!this.backend) {
            return;
        }
        for (const player of this.backend.devices) {
            if (sonosIp && player.channel !== sonosIp) {
                continue;
            }
            callback(player);
        }
    }
    /**
     * Play an URI on all players or on one specific player
     *
     * @param uri URI of the file to play
     * @param sonosIp IP address (with underscores) of one player or undefined for all players
     * @param volume volume to play with
     */
    playOnAllPlayers(uri, sonosIp, volume) {
        this.forEachPlayer(sonosIp, player => setTimeout(() => this.playOnSonos(uri, player.uuid, volume), 100));
    }
    /**
     * Stop the running announcement on all players or on one specific player
     *
     * @param sonosIp IP address (with underscores) of one player or undefined for all players
     */
    stopTTS(sonosIp) {
        this.forEachPlayer(sonosIp, player => this.tts[player.uuid]?.immediatelyStopTTS());
    }
    playOnSonos(uri, sonosUuid, volume) {
        const player = this.backend?.getDeviceByUuid(sonosUuid);
        if (!player) {
            return;
        }
        this.tts[player.uuid] ||= new tts_1.TTS(this, player);
        this.tts[player.uuid].add(uri, volume);
    }
    //////////////////
    // Group management
    getPlayerByName(name) {
        return this.backend?.devices.find(player => player.roomName === name || player.channel === name || player.channel === name || player.uuid === name);
    }
    /** HT satellites are bonded to the soundbar; group the primary instead. */
    resolveGroupPlayer(name) {
        const player = typeof name === 'string' ? this.getPlayerByName(name) : name;
        if (!player) {
            return undefined;
        }
        const bond = (0, home_theater_1.findHomeTheaterBond)(this.htBonds, player.uuid) || (0, home_theater_1.findHomeTheaterBond)(this.htBonds, player.channel || '');
        if (bond && (0, home_theater_1.isHomeTheaterSatellite)(this.htBonds, player.uuid)) {
            return this.backend?.getDeviceByUuid(bond.primaryUuid) || player;
        }
        return player;
    }
    async ensureHomeTheaterState() {
        await this.setObjectNotExistsAsync('home_theater', {
            type: 'state',
            common: {
                name: 'Home theater bonds',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
                desc: 'Soundbar and bonded surround IPs (HTSatChanMapSet)',
            },
            native: {},
        });
        await this.writeIfChanged('home_theater', (0, home_theater_1.homeTheaterStateJson)(this.htBonds), true);
    }
    scheduleHomeTheaterRefresh() {
        if (this.htRefreshTimer) {
            clearTimeout(this.htRefreshTimer);
        }
        this.htRefreshTimer = setTimeout(() => {
            this.htRefreshTimer = null;
            void this.refreshHomeTheaterBonds();
        }, 400);
    }
    /** After grouping, topology settles late and satellites often stay muted. */
    scheduleHomeTheaterHeal() {
        this.scheduleHomeTheaterRefresh();
        if (this.htHealTimer) {
            clearTimeout(this.htHealTimer);
        }
        if (this.htHealRetryTimer) {
            clearTimeout(this.htHealRetryTimer);
        }
        this.htHealTimer = setTimeout(() => {
            this.htHealTimer = null;
            void this.healHomeTheaterBonds();
        }, 900);
        this.htHealRetryTimer = setTimeout(() => {
            this.htHealRetryTimer = null;
            void this.healHomeTheaterBonds();
        }, 2800);
    }
    async refreshHomeTheaterBonds() {
        const player = this.backend?.devices.find(item => item.baseUrl);
        if (!player) {
            return;
        }
        try {
            const xml = await (0, home_theater_1.soapGetZoneGroupState)(player.baseUrl);
            const fresh = (0, home_theater_1.parseHomeTheaterBonds)(xml);
            const next = (0, home_theater_1.rememberHomeTheaterBonds)(this.htBonds, fresh, this.htBondsSeenAt);
            this.htBonds = next.bonds;
            this.htBondsSeenAt = next.seenAt;
            await this.writeIfChanged('home_theater', (0, home_theater_1.homeTheaterStateJson)(this.htBonds), true);
        }
        catch (err) {
            this.log.debug(`Cannot read home theater topology: ${err}`);
        }
    }
    async healHomeTheaterBonds() {
        await this.refreshHomeTheaterBonds();
        for (const bond of this.htBonds) {
            try {
                await (0, home_theater_1.unmuteHomeTheaterBond)(bond);
                for (const sat of bond.satellites) {
                    const satellite = this.backend?.getDeviceByUuid(sat.uuid);
                    if (satellite) {
                        await satellite.setMute(false).catch(() => undefined);
                    }
                }
                this.log.debug(`Restored home theater speakers for ${bond.primaryUuid}`);
            }
            catch (err) {
                this.log.debug(`Cannot restore home theater speakers: ${err}`);
            }
        }
    }
    addToGroup(playerNameToAdd, coordinator) {
        const coordinatorPlayer = this.resolveGroupPlayer(coordinator);
        const playerToAdd = this.resolveGroupPlayer(playerNameToAdd);
        if (!coordinatorPlayer || !playerToAdd) {
            return Promise.reject(new Error(`Cannot add "${playerNameToAdd}" to group: player not found`));
        }
        if (coordinatorPlayer.uuid === playerToAdd.uuid) {
            this.scheduleHomeTheaterHeal();
            return Promise.resolve();
        }
        this.scheduleHomeTheaterHeal();
        return playerToAdd.setTransportUri(`x-rincon:${coordinatorPlayer.uuid}`);
    }
    removeFromGroup(leavingName, coordinator) {
        const coordinatorPlayer = this.resolveGroupPlayer(coordinator);
        const leavingPlayer = this.resolveGroupPlayer(leavingName);
        if (!coordinatorPlayer || !leavingPlayer) {
            return Promise.reject(new Error(`Cannot remove "${leavingName}" from group: player not found`));
        }
        this.scheduleHomeTheaterHeal();
        if (leavingPlayer.uuid === coordinatorPlayer.uuid) {
            return Promise.resolve();
        }
        if (leavingPlayer.coordinator === coordinatorPlayer) {
            return leavingPlayer.leaveGroup();
        }
        if (coordinatorPlayer.coordinator === leavingPlayer) {
            return coordinatorPlayer.leaveGroup();
        }
        return Promise.resolve();
    }
    // State of sonos device was changed
    async takeSonosState(ip, sonosState) {
        await this.setState({ device: 'root', channel: ip, state: 'alive' }, { val: true, ack: true });
        const player = this.backend?.getDeviceByUuid(this.channels[ip].uuid);
        if (!player) {
            this.log.debug(`Cannot find player for ${ip}`);
            return;
        }
        const ps = getPlaybackState(sonosState.playbackState);
        const playMode = sonosState.playMode;
        const metaEarly = typeof player.transportUriMetadata === 'string' ? player.transportUriMetadata : '';
        const hint = this.lastPlaybackHint[ip];
        const hintFresh = Boolean(hint && Date.now() - hint.at < 15000);
        this.log.debug(`>  playbackState: ${sonosState.playbackState} - ${sonosState.currentTrack?.title || ''}`);
        const stableState = !ps.transitioning;
        // If some stable state
        if (stableState) {
            await this.setState({ device: 'root', channel: ip, state: 'state_simple' }, { val: ps.playing, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'state' }, { val: ps.paused ? 'pause' : ps.playing ? 'play' : 'stop', ack: true });
            // if duration is 0 (type is radio):
            // - no changes expected and a state update is not necessary!
            // - division by 0
            // A slave gets its elapsed time from the coordinator's tick, so only the
            // coordinator (or a standalone player) needs a timer.
            if (ps.playing &&
                (this.channels[ip].duration > 0 || Boolean(hintFresh && hint?.duration)) &&
                !this.isGroupSlave(ip)) {
                if (!this.channels[ip].elapsedTimer) {
                    this.channels[ip].elapsedTimer = setInterval(() => this.updateElapsed(ip), this.config.elapsedInterval || 5000);
                }
            }
            else {
                this.stopElapsedTimer(ip);
            }
        }
        // [hraab]
        // type: radio|track|line_in
        // when radio:
        //   radioShowMetaData (current show, contains an id separated by comma)
        //   streamInfo (kind of currently played title and artist info)
        //   title (== station)
        //
        // Still work to do:
        // - Tracks w/o Album name keeps album name from previous track or some random album.
        //   Don't know if this is already wrong from SONOS API.
        const meta = metaEarly;
        let playing = this.playbackDisplay(sonosState, meta);
        if (hintFresh && hint) {
            if (!playing.title) {
                playing = {
                    type: 0,
                    title: hint.title,
                    artist: hint.artist || playing.artist,
                    album: hint.album || playing.album,
                    station: '',
                };
            }
            else if (playing.type === 1 &&
                (hint.duration > 0 || hint.artist || (0, content_directory_1.shouldPlayAsTrack)(hint.uri, hint.metadata, hint))) {
                playing = {
                    type: 0,
                    title: hint.title || playing.title,
                    artist: hint.artist || playing.artist,
                    album: hint.album || playing.album,
                    station: '',
                };
            }
        }
        if ((0, content_directory_1.isTvStreamUri)(sonosState.currentTrack.uri)) {
            const format = await this.resolveTvFormat(player, sonosState.currentTrack, meta);
            playing = { ...playing, artist: format };
            this.startTvFormatWatch(ip);
        }
        else {
            this.stopTvFormatWatch(ip);
            delete this.lastTvFormat[player.uuid];
            delete this.lastTvFormatFetch[player.uuid];
            delete this.lastTvFormatWritten[ip];
        }
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_type' }, playing.type);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_station' }, playing.station);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_title' }, playing.title);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_album' }, playing.album);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_artist' }, playing.artist);
        const resume = (0, quickstart_1.resumeFromPlayer)(player);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_uri' }, resume.uri);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_metadata' }, resume.metadata);
        // elapsed time
        await this.setState({ device: 'root', channel: ip, state: 'current_duration' }, { val: sonosState.currentTrack.duration, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_duration_s' }, { val: toFormattedTime(sonosState.currentTrack.duration), ack: true });
        // Track number
        await this.setState({ device: 'root', channel: ip, state: 'current_track_number' }, { val: sonosState.trackNo, ack: true });
        // Update html-queue: highlight current track
        if (player.channel) {
            await this.updateHtmlQueue(player.channel, sonosState.trackNo);
        }
        const tvCover = (0, content_directory_1.isTvStreamUri)(sonosState.currentTrack.uri);
        const albumArt = tvCover ? '' : sonosState.currentTrack.albumArtUri || '';
        if (albumArt && !this.isSharedLiveCover(albumArt)) {
            this.lastStableCover[ip] = albumArt;
            await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_art' }, albumArt);
        }
        else if (hintFresh && hint?.cover && !this.isSharedLiveCover(hint.cover)) {
            this.lastStableCover[ip] = hint.cover;
            await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_art' }, hint.cover);
        }
        const coverKey = tvCover ? 'tv' : albumArt || '';
        if (this.lastCover[ip] !== coverKey) {
            if (tvCover) {
                await this.syncCoverFileToStorage(TV_IMAGE, ip);
            }
            else {
                await this.updateCover(ip, sonosState.currentTrack.albumArtUri);
            }
            this.lastCover[ip] = coverKey || null;
        }
        this.channels[ip].elapsed = sonosState.elapsedTime;
        this.channels[ip].duration = sonosState.currentTrack.duration;
        // only if duration !== 0, see above
        if (this.channels[ip].duration > 0) {
            await this.setState({ device: 'root', channel: ip, state: 'current_elapsed' }, { val: sonosState.elapsedTime, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'seek' }, {
                val: Math.round((this.channels[ip].elapsed / this.channels[ip].duration) * 1000) / 10,
                ack: true,
            });
            await this.setState({ device: 'root', channel: ip, state: 'current_elapsed_s' }, { val: sonosState.elapsedTimeFormatted, ack: true });
        }
        await this.setState({ device: 'root', channel: ip, state: 'volume' }, { val: sonosState.volume, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'night_mode' }, { val: Boolean(sonosState.equalizer?.nightMode), ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'speech_enhancement' }, { val: Boolean(sonosState.equalizer?.speechEnhancement), ack: true });
        if (sonosState.groupState) {
            await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: sonosState.groupState.mute, ack: true });
        }
        if (playMode) {
            await this.setState({ device: 'root', channel: ip, state: 'shuffle' }, { val: playMode.shuffle, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'repeat' }, { val: playMode.repeat === 'all' ? 1 : playMode.repeat === 'one' ? 2 : 0, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'crossfade' }, { val: playMode.crossfade, ack: true });
        }
        const tts = this.tts[player.uuid];
        if (tts) {
            if (stableState && (ps.paused || ps.stopped)) {
                tts.playingEnded();
            }
            else if (ps.playing) {
                tts.playingStarted();
            }
        }
        const coverState = await this.getStateAsync(`root.${ip}.current_cover`);
        const coverUrl = String(coverState?.val || '');
        const isCoordinator = !player.coordinator || player.coordinator.uuid === player.uuid;
        if (!tts && (isCoordinator || !isGroupingUri(sonosState.currentTrack.uri))) {
            await this.appendRecentTrack(ip, sonosState, coverUrl);
        }
        if (isCoordinator && !tts) {
            await this.copyPlaybackToGroupMembers(ip, sonosState, ps, coverUrl, playing);
        }
    }
    playbackDisplay(sonosState, metadata) {
        const track = sonosState.currentTrack;
        const display = (0, content_directory_1.nowPlayingLabels)(track, { tv: 'TV', tvHdmi: 'HDMI', lineIn: 'Line-In' }, { metadata });
        const uri = track.uri;
        const tv = (0, content_directory_1.isTvStreamUri)(uri);
        const lineIn = (0, content_directory_1.isLineInStreamUri)(uri) || track.type === 'line_in';
        if (track.type === 'radio' && !tv && !lineIn) {
            return {
                type: 1,
                title: display.title,
                artist: display.artist,
                album: display.album,
                station: track.stationName || display.station,
            };
        }
        if (tv || lineIn) {
            return { type: 2, ...display };
        }
        return { type: 0, title: display.title, artist: display.artist, album: display.album, station: '' };
    }
    startTvFormatWatch(ip) {
        const channel = this.channels[ip];
        if (!channel || channel.tvFormatTimer) {
            return;
        }
        channel.tvFormatTimer = setInterval(() => {
            void this.refreshTvFormat(ip);
        }, TV_FORMAT_POLL_MS);
    }
    stopTvFormatWatch(ip) {
        const channel = this.channels[ip];
        if (channel?.tvFormatTimer) {
            clearInterval(channel.tvFormatTimer);
            channel.tvFormatTimer = null;
        }
    }
    async refreshTvFormat(ip) {
        const channel = this.channels[ip];
        const player = channel?.player || (channel?.uuid ? this.backend?.getDeviceByUuid(channel.uuid) : undefined);
        const uri = player ? player.transportUri : '';
        if (!player || !(0, content_directory_1.isTvStreamUri)(uri)) {
            this.stopTvFormatWatch(ip);
            return;
        }
        const meta = typeof player.transportUriMetadata === 'string' ? player.transportUriMetadata : '';
        const format = await this.resolveTvFormat(player, player.state?.currentTrack || {}, meta);
        if (this.lastTvFormatWritten[ip] === format) {
            return;
        }
        this.lastTvFormatWritten[ip] = format;
        await this.setState({ device: 'root', channel: ip, state: 'current_artist' }, { val: format, ack: true });
        for (const memberIp of this.getGroupMemberIps(ip)) {
            if (memberIp === ip || !this.channels[memberIp]) {
                continue;
            }
            await this.setState({ device: 'root', channel: memberIp, state: 'current_artist' }, { val: format, ack: true });
        }
    }
    async resolveTvFormat(player, track, metadata) {
        const now = Date.now();
        if ((this.lastTvFormatFetch[player.uuid] || 0) + TV_FORMAT_CACHE_MS > now &&
            Object.prototype.hasOwnProperty.call(this.lastTvFormat, player.uuid)) {
            return this.lastTvFormat[player.uuid];
        }
        this.lastTvFormatFetch[player.uuid] = now;
        // What the track and the transport metadata already say, before asking the speaker
        const fromEvent = (0, content_directory_1.tvAudioFormat)(track.title) || (0, content_directory_1.tvAudioFormat)((0, content_directory_1.streamContentFromDidl)(metadata)) || (0, content_directory_1.tvAudioFormat)(track.artist);
        try {
            const format = (await player.tvAudioFormat()) || fromEvent;
            this.lastTvFormat[player.uuid] = format || '';
            return format || '';
        }
        catch (err) {
            this.log.debug(`TV audio format: ${err}`);
            return fromEvent || this.lastTvFormat[player.uuid] || '';
        }
    }
    recentKey(sonosState, metadata) {
        const playing = this.playbackDisplay(sonosState, metadata);
        return `${playing.title}|${playing.artist}|${playing.album}`;
    }
    async appendRecentTrack(ip, sonosState, coverUrl) {
        const playing = this.playbackDisplay(sonosState);
        const title = playing.title.trim();
        const trackUri = String(sonosState.currentTrack.uri || '');
        if (!title ||
            !this.channels[ip] ||
            isGroupingUri(trackUri) ||
            (0, content_directory_1.isTvStreamUri)(trackUri) ||
            (0, content_directory_1.isLineInStreamUri)(trackUri)) {
            return;
        }
        const key = this.recentKey(sonosState);
        if (this.lastHistoryKey[ip] === key) {
            return;
        }
        this.lastHistoryKey[ip] = key;
        let list = [];
        const current = await this.getStateAsync(`root.${ip}.recent_tracks`);
        if (Array.isArray(current?.val)) {
            list = current.val;
        }
        else if (current?.val) {
            try {
                const parsed = JSON.parse(String(current.val));
                if (Array.isArray(parsed)) {
                    list = parsed;
                }
            }
            catch {
                list = [];
            }
        }
        const player = this.channels[ip]?.player ||
            (this.channels[ip]?.uuid ? this.backend?.getDeviceByUuid(this.channels[ip].uuid) : undefined);
        const resume = player ? (0, quickstart_1.resumeFromPlayer)(player) : { uri: trackUri, metadata: '', tv: false };
        const uniqueCover = this.lastStableCover[ip] || (this.isSharedLiveCover(coverUrl) ? '' : coverUrl);
        const entry = {
            title: playing.type === 1 ? playing.station || title : title,
            artist: playing.type === 1 ? '' : playing.artist,
            album: playing.type === 1 ? '' : playing.album,
            station: playing.station,
            cover: uniqueCover,
            uri: resume.uri || trackUri,
            metadata: resume.metadata,
            duration: playing.type === 1 ? 0 : Number(sonosState.currentTrack.duration) || 0,
            ts: Date.now(),
        };
        list = [entry, ...list.filter(item => `${item.title}|${item.artist}|${item.album}` !== key)].slice(0, RECENT_TRACKS_MAX);
        await this.setState({ device: 'root', channel: ip, state: 'recent_tracks' }, { val: JSON.stringify(list), ack: true });
    }
    async copyPlaybackToGroupMembers(coordinatorIp, sonosState, ps, coverUrl, display) {
        const membersState = await this.getStateAsync(`root.${coordinatorIp}.membersChannels`);
        const members = String(membersState?.val || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        if (members.length < 2) {
            return;
        }
        const queue = await this.getStateAsync(`root.${coordinatorIp}.queue`);
        const queueHtml = await this.getStateAsync(`root.${coordinatorIp}.queue_html`);
        const playMode = sonosState.playMode;
        const playing = display || this.playbackDisplay(sonosState);
        for (const memberIp of members) {
            if (!memberIp || memberIp === coordinatorIp || !this.channels[memberIp]) {
                continue;
            }
            if (!ps.transitioning) {
                await this.setState({ device: 'root', channel: memberIp, state: 'state_simple' }, { val: ps.playing, ack: true });
                await this.setState({ device: 'root', channel: memberIp, state: 'state' }, { val: ps.paused ? 'pause' : ps.playing ? 'play' : 'stop', ack: true });
            }
            await this.setState({ device: 'root', channel: memberIp, state: 'current_type' }, { val: playing.type, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_station' }, { val: playing.station, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_title' }, { val: playing.title, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_album' }, { val: playing.album, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_artist' }, { val: playing.artist, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_duration' }, { val: sonosState.currentTrack.duration, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_duration_s' }, { val: toFormattedTime(sonosState.currentTrack.duration), ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_track_number' }, { val: sonosState.trackNo, ack: true });
            await this.setState({ device: 'root', channel: memberIp, state: 'current_cover' }, { val: coverUrl, ack: true });
            this.channels[memberIp].elapsed = sonosState.elapsedTime;
            this.channels[memberIp].duration = sonosState.currentTrack.duration;
            if (sonosState.currentTrack.duration > 0) {
                await this.setState({ device: 'root', channel: memberIp, state: 'current_elapsed' }, { val: sonosState.elapsedTime, ack: true });
                await this.setState({ device: 'root', channel: memberIp, state: 'seek' }, {
                    val: Math.round((sonosState.elapsedTime / sonosState.currentTrack.duration) * 1000) / 10,
                    ack: true,
                });
                await this.setState({ device: 'root', channel: memberIp, state: 'current_elapsed_s' }, { val: sonosState.elapsedTimeFormatted, ack: true });
            }
            if (playMode) {
                await this.setState({ device: 'root', channel: memberIp, state: 'shuffle' }, { val: playMode.shuffle, ack: true });
                await this.setState({ device: 'root', channel: memberIp, state: 'repeat' }, { val: playMode.repeat === 'all' ? 1 : playMode.repeat === 'one' ? 2 : 0, ack: true });
                await this.setState({ device: 'root', channel: memberIp, state: 'crossfade' }, { val: playMode.crossfade, ack: true });
            }
            if (queue?.val !== undefined && queue.val !== null) {
                await this.setState({ device: 'root', channel: memberIp, state: 'queue' }, { val: queue.val, ack: true });
            }
            if (queueHtml?.val !== undefined && queueHtml.val !== null) {
                await this.setState({ device: 'root', channel: memberIp, state: 'queue_html' }, { val: queueHtml.val, ack: true });
            }
            await this.appendRecentTrack(memberIp, sonosState, coverUrl);
        }
    }
    /** After grouping changes, copy the master's now-playing onto members */
    async syncGroupPlayback(coordinatorIp) {
        const uuid = this.channels[coordinatorIp]?.uuid;
        const player = uuid ? this.backend?.getDeviceByUuid(uuid) : undefined;
        if (!player || this.tts[player.uuid] || !player.state?.currentTrack) {
            return;
        }
        const coverState = await this.getStateAsync(`root.${coordinatorIp}.current_cover`);
        await this.copyPlaybackToGroupMembers(coordinatorIp, player.state, getPlaybackState(player.state.playbackState), String(coverState?.val || ''));
    }
    isGermanUi() {
        const lang = this.language;
        return String(lang || '')
            .toLowerCase()
            .startsWith('de');
    }
    musicServiceInfo(name) {
        const services = this.backend?.musicServices || {};
        const key = Object.keys(services).find(item => item.toLowerCase() === name.toLowerCase());
        if (key) {
            return services[key];
        }
        if (name.toLowerCase() === 'spotify') {
            return { id: 9, type: 2311 };
        }
        return undefined;
    }
    /** Where the music service tokens are kept; both backends use the same file */
    getTokenFile() {
        let dir = path.join(os.tmpdir(), this.namespace);
        try {
            dir = utils.getAbsoluteInstanceDataDir(this);
        }
        catch {
            // unit tests / missing controller paths
        }
        return path.join(dir, 'smapi-tokens.json');
    }
    /**
     * Service catalog via SMAPI where the service offers one. Everything else is
     * listed from what the household already knows: saved Sonos favorites,
     * playlists and the recently played tracks of that room.
     */
    async listServiceLibrary(player, serviceName, german, query = '') {
        const items = [];
        let loginUrl;
        let loginHint;
        const info = this.musicServiceInfo(serviceName);
        const term = query.trim().toLowerCase();
        const blobOf = (item) => [item.title, item.uri, item.albumArtUri, item.metadata].filter(Boolean).join('\n');
        const matchesQuery = (item) => {
            if (!term) {
                return true;
            }
            return [item.title, item.artist, item.album].some(part => String(part || '')
                .toLowerCase()
                .includes(term));
        };
        try {
            const smapi = await this.backend.music.browse(serviceName, 'root', german);
            items.push(...smapi.items.filter(matchesQuery));
            loginUrl = smapi.loginUrl;
            loginHint = smapi.loginHint;
        }
        catch (err) {
            this.log.warn(`SMAPI browse ${serviceName}: ${err}`);
        }
        try {
            const favorites = (await this.backend?.getFavorites()) || [];
            for (const fav of favorites) {
                if (!fav.title || !(0, content_directory_1.matchesMusicService)(blobOf(fav), serviceName, info) || !matchesQuery(fav)) {
                    continue;
                }
                items.push({
                    id: `favorite:${fav.title}`,
                    title: fav.title,
                    uri: fav.uri || '',
                    metadata: fav.metadata || '',
                    artist: german ? 'Favorit' : 'Favorite',
                    album: serviceName,
                    cover: fav.albumArtUri || '',
                    folder: false,
                    favorite: fav.title,
                });
            }
        }
        catch (err) {
            this.log.warn(`Cannot list ${serviceName} favorites: ${err}`);
        }
        try {
            if (this.backend?.getPlaylists) {
                const playlists = await this.backend.getPlaylists();
                for (const playlist of playlists) {
                    if (!playlist.title ||
                        !(0, content_directory_1.matchesMusicService)(blobOf(playlist), serviceName, info) ||
                        !matchesQuery(playlist)) {
                        continue;
                    }
                    items.push({
                        id: `playlist:${playlist.title}`,
                        title: playlist.title,
                        uri: playlist.uri || '',
                        metadata: playlist.metadata || '',
                        artist: 'Playlist',
                        album: serviceName,
                        cover: playlist.albumArtUri || '',
                        folder: false,
                        playlist: playlist.title,
                    });
                }
            }
        }
        catch (err) {
            this.log.warn(`Cannot list ${serviceName} playlists: ${err}`);
        }
        try {
            const recents = await this.loadRecentTracks(player.channel || player.channel);
            for (const recent of recents) {
                if (!recent.title || isGroupingUri(recent.uri)) {
                    continue;
                }
                if (!(0, content_directory_1.matchesMusicService)(blobOf(recent), serviceName, info) || !matchesQuery(recent)) {
                    continue;
                }
                items.push({
                    id: `recent:${recent.uri || recent.title}`,
                    title: recent.title,
                    uri: recent.uri || '',
                    metadata: '',
                    artist: recent.artist || (german ? 'Zuletzt' : 'Recent'),
                    album: recent.album || serviceName,
                    cover: recent.cover || '',
                    folder: false,
                });
            }
        }
        catch (err) {
            this.log.warn(`Cannot list ${serviceName} recent tracks: ${err}`);
        }
        if (term) {
            loginUrl = undefined;
            loginHint = undefined;
        }
        if (!items.length) {
            const emptyTitle = term
                ? german
                    ? `Keine Treffer für „${query.trim()}“ in Favoriten, Playlists oder Zuletzt gehört.`
                    : `No matches for “${query.trim()}” in favorites, playlists or recently played.`
                : german
                    ? `${serviceName} ist als Quelle verfügbar. In der Sonos-App suchen und Favoriten oder Playlists speichern.`
                    : `${serviceName} is available as a source. Search in the Sonos app and save favorites or playlists.`;
            items.push((0, content_directory_1.mediaItem)({ id: '', title: emptyTitle }));
        }
        return {
            id: `service:${serviceName}`,
            title: serviceName,
            items,
            serviceName,
            searchable: true,
            loginUrl,
            loginHint,
        };
    }
    async loadRecentTracks(ip) {
        if (!ip) {
            return [];
        }
        const current = await this.getStateAsync(`root.${ip}.recent_tracks`);
        if (Array.isArray(current?.val)) {
            return current.val;
        }
        if (current?.val) {
            try {
                const parsed = JSON.parse(String(current.val));
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
            catch {
                return [];
            }
        }
        return [];
    }
    async handleMediaBrowse(player, ip, objectId, sourcePlayer) {
        const id = objectId.trim() || 'root';
        const german = this.isGermanUi();
        const labels = {
            radio: 'TuneIn Radio',
            library: german ? 'Mediathek' : 'Music library',
            shares: german ? 'Netzlaufwerke' : 'Network shares',
            lineIn: 'Line-In',
            tv: 'TV',
            tvHdmi: 'HDMI',
        };
        let result;
        if (id === 'root') {
            // The TV entry belongs to the room the user selected, not to the group
            // coordinator, and only soundbars/amps have that input at all.
            const tvPlayer = sourcePlayer || player;
            let homeTheater = false;
            try {
                homeTheater = await tvPlayer.hasTvInput();
            }
            catch (err) {
                this.log.debug(`Cannot probe HDMI input of ${tvPlayer.roomName}: ${err}`);
            }
            result = (0, content_directory_1.getMediaRoot)(this.backend?.musicServices, labels, tvPlayer.uuid, { homeTheater });
            result.title = german ? 'Quellen' : 'Sources';
        }
        else if (id.startsWith('smapi-search:')) {
            const rest = id.slice('smapi-search:'.length);
            const colon = rest.indexOf(':');
            const name = decodeURIComponent(colon === -1 ? rest : rest.slice(0, colon));
            const term = decodeURIComponent(colon === -1 ? '' : rest.slice(colon + 1));
            try {
                if (await this.backend.music.hasCatalog(name)) {
                    const smapi = await this.backend.music.search(name, term, german);
                    result = {
                        id,
                        title: term || name,
                        items: smapi.items,
                        serviceName: name,
                        searchable: true,
                        loginUrl: smapi.loginUrl,
                        loginHint: smapi.loginHint,
                    };
                }
                else if ((0, ytmusic_1.isYoutubeMusicName)(name)) {
                    const ytm = await (0, ytmusic_1.searchYoutubeMusic)(term, '0', german);
                    result = {
                        id,
                        title: term || name,
                        items: ytm.items,
                        serviceName: name,
                        searchable: true,
                        loginHint: ytm.hint,
                    };
                }
                else {
                    result = await this.listServiceLibrary(player, name, german, term);
                    result.id = id;
                    result.title = term || name;
                }
            }
            catch (err) {
                this.log.warn(`SMAPI search ${name}: ${err}`);
                result = { id, title: name, items: [], serviceName: name, searchable: true };
            }
        }
        else if (id.startsWith('smapi-auth:')) {
            const name = decodeURIComponent(id.slice('smapi-auth:'.length));
            const ok = await this.backend.music.completeLogin(name);
            if (ok) {
                result = await this.listServiceLibrary(player, name, german);
                result.id = (0, smapi_1.encodeSmapiId)(name, 'root');
            }
            else {
                result = {
                    id,
                    title: name,
                    items: [
                        (0, content_directory_1.mediaItem)({
                            id: '',
                            title: german
                                ? 'Anmeldung noch nicht fertig. Seite im Browser abschließen und erneut tippen.'
                                : 'Sign-in is not finished yet. Complete it in the browser, then tap again.',
                        }),
                    ],
                    serviceName: name,
                    searchable: true,
                };
            }
        }
        else if (id.startsWith('smapi:')) {
            const parsed = (0, smapi_1.parseSmapiId)(id);
            if (!parsed) {
                result = { id, title: id, items: [] };
            }
            else {
                try {
                    const smapi = await this.backend.music.browse(parsed.serviceName, parsed.itemId, german);
                    result = {
                        id,
                        title: parsed.serviceName,
                        items: smapi.items,
                        serviceName: parsed.serviceName,
                        searchable: true,
                        loginUrl: smapi.loginUrl,
                        loginHint: smapi.loginHint,
                    };
                }
                catch (err) {
                    this.log.warn(`SMAPI browse ${parsed.serviceName}: ${err}`);
                    result = {
                        id,
                        title: parsed.serviceName,
                        items: [],
                        serviceName: parsed.serviceName,
                        searchable: true,
                    };
                }
            }
        }
        else if (id.startsWith('service:')) {
            const name = id.slice('service:'.length);
            result = await this.listServiceLibrary(player, name, german);
        }
        else {
            try {
                result = { id, title: id, items: await player.browse(id) };
            }
            catch (err) {
                this.log.warn(`Cannot browse media ${id}: ${err.message || err}`);
                result = { id, title: id, items: [] };
            }
        }
        await this.setState({ device: 'root', channel: ip, state: 'media_browse_result' }, { val: JSON.stringify(result), ack: true });
    }
    /** Radio/SMAPI need Play after SetAVTransportURI. HDMI and line-in start on set and reject Play with HTTP 500. */
    async startAvTransport(player, uri, metadata = '') {
        const playUri = (0, content_directory_1.wrapHttpRadioUri)(uri);
        let meta = metadata;
        if ((0, content_directory_1.isRadioLikeUri)(playUri) && !meta) {
            meta = (0, content_directory_1.radioBroadcastDidl)(player.state.currentTrack.stationName || player.state.currentTrack.title || 'Radio');
        }
        await player.setTransportUri(playUri, meta);
        if ((0, content_directory_1.isTvStreamUri)(playUri) || (0, content_directory_1.isLineInStreamUri)(playUri)) {
            return;
        }
        await player.play();
    }
    /** Switch the soundbar itself to HDMI. Play is not a valid AVTransport action for TV. */
    async playTvInput(ht) {
        const uri = (0, content_directory_1.tvStreamUri)(ht.uuid);
        if (ht.transportUri === uri) {
            this.log.debug(`TV HDMI already selected on ${ht.roomName}`);
            return;
        }
        if (!(await ht.hasTvInput())) {
            this.log.warn(`${ht.roomName} has no HDMI/optical input - TV cannot be selected there`);
            return;
        }
        if (ht.isGroupMember) {
            await ht.leaveGroup();
        }
        await ht.setTransportUri(uri);
        this.scheduleHomeTheaterHeal();
    }
    async applyPlaybackHint(ip, hint) {
        if (!hint.title && !hint.uri) {
            return;
        }
        this.lastPlaybackHint[ip] = { ...hint, at: Date.now() };
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_type' }, 0);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_station' }, '');
        if (hint.title) {
            await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_title' }, hint.title);
        }
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_artist' }, hint.artist || '');
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_album' }, hint.album || '');
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_uri' }, hint.uri);
        await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_metadata' }, hint.metadata);
        if (hint.duration > 0) {
            this.channels[ip].duration = hint.duration;
            this.channels[ip].elapsed = 0;
            await this.setState({ device: 'root', channel: ip, state: 'current_duration' }, { val: hint.duration, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'current_duration_s' }, { val: toFormattedTime(hint.duration), ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'current_elapsed' }, { val: 0, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'current_elapsed_s' }, { val: '00:00', ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'seek' }, { val: 0, ack: true });
            if (!this.channels[ip].elapsedTimer && !this.isGroupSlave(ip)) {
                this.channels[ip].elapsedTimer = setInterval(() => this.updateElapsed(ip), this.config.elapsedInterval || 5000);
            }
        }
        const cover = hint.cover && !this.isSharedLiveCover(hint.cover) ? hint.cover : '';
        if (cover) {
            this.lastStableCover[ip] = cover;
            await this.writeIfChanged({ device: 'root', channel: ip, state: 'current_art' }, cover);
        }
        await this.setState({ device: 'root', channel: ip, state: 'state' }, { val: 'play', ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'state_simple' }, { val: true, ack: true });
        for (const memberIp of this.getGroupMemberIps(ip)) {
            if (memberIp === ip || !this.channels[memberIp]) {
                continue;
            }
            await this.writeIfChanged({ device: 'root', channel: memberIp, state: 'current_type' }, 0);
            if (hint.title) {
                await this.writeIfChanged({ device: 'root', channel: memberIp, state: 'current_title' }, hint.title);
            }
            if (cover) {
                this.lastStableCover[memberIp] = cover;
                await this.writeIfChanged({ device: 'root', channel: memberIp, state: 'current_art' }, cover);
            }
            await this.setState({ device: 'root', channel: memberIp, state: 'state' }, { val: 'play', ack: true });
        }
    }
    async handleMediaPlay(player, raw, sourcePlayer) {
        let uri = '';
        let metadata = '';
        let hintTitle = '';
        let hintArtist = '';
        let hintAlbum = '';
        let hintCover = '';
        let hintDuration = 0;
        const text = raw.trim();
        if (!text) {
            return;
        }
        if (text.startsWith('{')) {
            try {
                const parsed = JSON.parse(text);
                if (parsed.favorite) {
                    await player.playFavorite(parsed.favorite);
                    return;
                }
                if (parsed.playlist) {
                    await player.playPlaylist(parsed.playlist);
                    return;
                }
                if (parsed.tv) {
                    await this.playTvInput(sourcePlayer || player);
                    return;
                }
                uri = String(parsed.uri || '').trim();
                metadata = String(parsed.metadata || '');
                hintTitle = String(parsed.title || '').trim();
                hintArtist = String(parsed.artist || '').trim();
                hintAlbum = String(parsed.album || '').trim();
                hintCover = String(parsed.cover || '').trim();
                hintDuration = Number(parsed.duration) || 0;
            }
            catch {
                uri = text;
            }
        }
        else {
            uri = text;
        }
        if (!uri || isGroupingUri(uri)) {
            return;
        }
        if ((0, content_directory_1.isTvStreamUri)(uri)) {
            await this.playTvInput(sourcePlayer || player);
            return;
        }
        const ip = player.channel;
        const asTrack = (0, content_directory_1.shouldPlayAsTrack)(uri, metadata, {
            title: hintTitle,
            artist: hintArtist,
            album: hintAlbum,
            duration: hintDuration,
        });
        if (asTrack && !(0, content_directory_1.isDirectPlayUri)(uri)) {
            const didl = (0, content_directory_1.trackDidl)({
                title: hintTitle,
                artist: hintArtist,
                album: hintAlbum,
                uri,
                cover: hintCover,
                durationSec: hintDuration,
                metadata,
            });
            await player.clearQueue();
            await player.addToQueue(uri, didl);
            await player.setTransportUri(`x-rincon-queue:${player.uuid}#0`);
            await player.play();
            if (ip) {
                await this.applyPlaybackHint(ip, {
                    title: hintTitle,
                    artist: hintArtist,
                    album: hintAlbum,
                    cover: hintCover,
                    uri,
                    metadata: didl,
                    duration: hintDuration,
                });
            }
            return;
        }
        if ((0, content_directory_1.isDirectPlayUri)(uri) || (0, content_directory_1.isRadioLikeUri)(uri) || (0, content_directory_1.isOnDemandUri)(uri) === false) {
            if (!asTrack) {
                await this.startAvTransport(player, uri, metadata || (0, content_directory_1.radioBroadcastDidl)(hintTitle || 'Radio'));
                if (ip) {
                    await this.applyPlaybackHint(ip, {
                        title: hintTitle,
                        artist: hintArtist,
                        album: hintAlbum,
                        cover: hintCover,
                        uri,
                        metadata,
                        duration: hintDuration,
                    });
                }
                return;
            }
        }
        await player.clearQueue();
        await player.addToQueue(uri, metadata);
        await player.setTransportUri(`x-rincon-queue:${player.uuid}#0`);
        await player.play();
        if (ip) {
            await this.applyPlaybackHint(ip, {
                title: hintTitle,
                artist: hintArtist,
                album: hintAlbum,
                cover: hintCover,
                uri,
                metadata,
                duration: hintDuration,
            });
        }
    }
    /** Players that currently share playback with this coordinator (includes itself) */
    getGroupMemberIps(coordinatorIp) {
        const channel = this.channels[coordinatorIp];
        const player = channel?.player || (channel?.uuid ? this.backend?.getDeviceByUuid(channel.uuid) : undefined);
        if (!player) {
            return [coordinatorIp];
        }
        const ips = player.groupMembers
            .map(member => member.channel)
            .filter((ip) => Boolean(ip) && Boolean(this.channels[ip]));
        return ips.length ? ips : [coordinatorIp];
    }
    /** True if the player belongs to a group and is not the coordinator of it */
    isGroupSlave(ip) {
        const channel = this.channels[ip];
        const player = channel?.player || (channel?.uuid ? this.backend?.getDeviceByUuid(channel.uuid) : undefined);
        return Boolean(player && player.isGroupMember);
    }
    stopElapsedTimer(ip) {
        const channel = this.channels[ip];
        if (channel?.elapsedTimer) {
            clearInterval(channel.elapsedTimer);
            channel.elapsedTimer = null;
        }
    }
    /** Update the elapsed time while playing */
    updateElapsed(ip) {
        const channel = this.channels[ip];
        if (!channel || channel.duration <= 0) {
            return;
        }
        // Slaves are fed by the coordinator's tick below. Without this every member of
        // a group would run its own timer and write to all members, so the number of
        // state writes per interval would grow with the square of the group size.
        if (this.isGroupSlave(ip)) {
            this.stopElapsedTimer(ip);
            return;
        }
        channel.elapsed += (this.config.elapsedInterval || 5000) / 1000;
        if (channel.elapsed > channel.duration) {
            channel.elapsed = channel.duration;
        }
        const seek = Math.round((channel.elapsed / channel.duration) * 1000) / 10;
        const elapsedS = toFormattedTime(channel.elapsed);
        for (const memberIp of this.getGroupMemberIps(ip)) {
            const member = this.channels[memberIp];
            if (!member) {
                continue;
            }
            member.elapsed = channel.elapsed;
            member.duration = channel.duration;
            void this.setState({ device: 'root', channel: memberIp, state: 'seek' }, { val: seek, ack: true });
            void this.setState({ device: 'root', channel: memberIp, state: 'current_elapsed' }, { val: channel.elapsed, ack: true });
            void this.setState({ device: 'root', channel: memberIp, state: 'current_elapsed_s' }, { val: elapsedS, ack: true });
        }
    }
    /**
     * Read the cover of the current track and store it in the ioBroker storage
     *
     * @param ip IP address (with underscores) of the player
     * @param albumArtUri URI of the cover on the sonos device
     */
    async updateCover(ip, albumArtUri) {
        let filePath = DEFAULT_IMAGE;
        if (albumArtUri) {
            const md5url = crypto.createHash('md5').update(albumArtUri).digest('hex');
            filePath = this.cacheDir + md5url;
        }
        if (fs.existsSync(filePath)) {
            this.log.debug('Cover exists. Try reading from fs');
            await this.syncCoverFileToStorage(filePath, ip);
            return;
        }
        this.log.debug('Cover file does not exist. Fetching via HTTP');
        const player = this.backend?.getDeviceByUuid(this.channels[ip].uuid);
        const hostname = player ? player.ip : null;
        if (!hostname || !albumArtUri) {
            return;
        }
        http.get({
            hostname,
            port: 1400,
            path: albumArtUri,
        }, res => {
            this.log.debug(`HTTP status code ${res.statusCode}`);
            if (res.statusCode === 200) {
                const cacheStream = fs.createWriteStream(filePath);
                res.pipe(cacheStream).on('finish', () => {
                    void this.syncCoverFileToStorage(filePath, ip);
                });
            }
            else if (res.statusCode === 404) {
                // no image exists! link it to the default image.
                res.resume();
                void this.syncCoverFileToStorage(DEFAULT_IMAGE, ip);
            }
            else {
                res.resume();
            }
            res.on('end', () => this.log.debug('Response "end" event'));
        }).on('error', e => this.log.warn(`Got error: ${e.message}`));
    }
    /**
     * Synchronize the cover file to ioBroker storage
     *
     * @param filePath path to read file from file system
     * @param ip ip of the player
     */
    async syncCoverFileToStorage(filePath, ip) {
        let fileData = null;
        try {
            fileData = fs.readFileSync(filePath);
        }
        catch (e) {
            this.log.warn(`Cannot read file: ${e.message}`);
        }
        // If error or null length file, read standard cover file
        if (!fileData) {
            try {
                fileData = fs.readFileSync(DEFAULT_IMAGE);
            }
            catch (e) {
                this.log.warn(`Cannot read file: ${e.message}`);
            }
        }
        if (fileData) {
            const storagePath = `coverImage/${ip}.png`;
            await this.writeFileAsync(this.name, storagePath, fileData);
            await this.setState({ device: 'root', channel: ip, state: 'current_cover' }, { val: `/${this.name}/${storagePath}`, ack: true });
        }
    }
    async takeSonosFavorites(ip, favorites) {
        let sFavorites = '';
        const aFavorites = [];
        const _hFavorites = [];
        _hFavorites.push('<table class="sonosFavoriteTable">');
        favorites.forEach((favorite, index) => {
            const title = favorite.title;
            if (title) {
                sFavorites += (sFavorites ? ', ' : '') + title;
                aFavorites.push(title);
                _hFavorites.push(`<tr class="sonosFavoriteRow" onclick="vis.setValue('${this.namespace}.root.${ip}.favorites_set', '${title}')"><td class="sonosFavoriteNumber">${index + 1}</td><td class="sonosFavoriteCover"><img src="${favorite.albumArtUri || ''}"></td><td class="sonosFavoriteTitle">${title}</td></tr>`);
            }
        });
        _hFavorites.push('</table>');
        await this.setState({ device: 'root', channel: ip, state: 'favorites_list' }, { val: sFavorites, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'favorites_list_array' }, { val: JSON.stringify(aFavorites), ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'favorites_list_html' }, { val: _hFavorites.join(''), ack: true });
    }
    /** Read the favorites from sonos and write them to all known players */
    async updateFavorites() {
        if (!this.backend) {
            return;
        }
        const favorites = await this.backend.getFavorites();
        // Go through all players
        for (const player of this.backend.devices) {
            if (!player) {
                continue;
            }
            const ip = player.channel;
            if (ip && this.channels[ip]) {
                await this.takeSonosFavorites(ip, favorites);
            }
        }
    }
    async takeSonosPlaylists(ip, playlists) {
        const names = playlists.map(item => item.title).filter((title) => Boolean(title));
        await this.setState({ device: 'root', channel: ip, state: 'playlist_list' }, { val: names.join(', '), ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'playlist_list_array' }, { val: JSON.stringify(names), ack: true });
    }
    /** Read Sonos playlists and write them to all known players */
    async updatePlaylists() {
        if (!this.backend?.getPlaylists) {
            return;
        }
        const playlists = await this.backend.getPlaylists();
        for (const player of this.backend.devices) {
            if (!player) {
                continue;
            }
            const ip = player.channel;
            if (ip && this.channels[ip]) {
                await this.takeSonosPlaylists(ip, playlists);
            }
        }
    }
    /** Refresh favorites and playlists; errors are logged and do not abort the other list */
    async updateMediaLists() {
        try {
            await this.updateFavorites();
        }
        catch (err) {
            this.log.error(`Cannot getFavorites: ${err}`);
        }
        try {
            await this.updatePlaylists();
            this.playlistsLoaded = true;
        }
        catch (err) {
            this.log.error(`Cannot getPlaylists: ${err}`);
        }
    }
    async processSonosEvents(event, data) {
        if (!this.backend) {
            return;
        }
        if (event === 'topology-change') {
            await this.processTopologyChange(data);
        }
        else if (event === 'transport-state') {
            const ip = this.getIpOfPlayer(data.uuid);
            if (ip) {
                this.channels[ip].uuid = data.uuid;
                await this.takeSonosState(ip, data.state);
            }
        }
        else if (event === 'group-volume') {
            const source = this.backend.getDeviceByUuid(data.uuid);
            const masterUuid = (source && source.coordinator)?.uuid;
            for (const player of this.backend.devices) {
                const itemMaster = player.coordinator;
                if (masterUuid && itemMaster.uuid !== masterUuid) {
                    continue;
                }
                if (!masterUuid && player.roomName !== data.roomName) {
                    continue;
                }
                const ip = this.getIpOfPlayer(player.uuid);
                if (ip) {
                    this.channels[ip].uuid = player.uuid;
                    await this.setState({ device: 'root', channel: ip, state: 'group_volume' }, { val: data.newVolume, ack: true });
                    this.log.debug(`group-volume: Volume for ${player.baseUrl}: ${data.newVolume}`);
                }
            }
        }
        else if (event === 'group-mute') {
            const player = this.backend.getDeviceByUuid(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: data.newMute, ack: true });
                player.muted = data.newMute;
                this.log.debug(`mute: Mute for ${player.baseUrl}: ${data.newMute}`);
                await this.setState({ device: 'root', channel: ip, state: 'group_muted' }, { val: player.groupState.mute, ack: true });
                this.log.debug(`group_muted: groupMuted for ${player.baseUrl}: ${player.groupState.mute}`);
            }
        }
        else if (event === 'volume') {
            const player = this.backend.getDeviceByUuid(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'volume' }, { val: data.newVolume, ack: true });
                player.volume = data.newVolume;
                this.log.debug(`volume: Volume for ${player.baseUrl}: ${data.newVolume}`);
            }
        }
        else if (event === 'treble' || event === 'bass') {
            // node-sonos-discovery is not emitting any events on treble/bass changes yet, so it is not
            // possible to get the externally set values, yet.
        }
        else if (event === 'mute') {
            const player = this.backend.getDeviceByUuid(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: data.newMute, ack: true });
                player.muted = data.newMute;
                this.log.debug(`mute: Mute for ${player.baseUrl}: ${data.newMute}`);
            }
        }
        else if (event === 'favorites') {
            await this.updateMediaLists();
        }
        else if (event === 'queue') {
            const player = this.backend.getDeviceByUuid(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.takeSonosQueue(ip, player, data.queue);
            }
            if (player) {
                await this.updateMediaLists();
            }
        }
        else {
            this.log.debug(`${event} ${typeof data === 'object' ? JSON.stringify(data) : data}`);
        }
    }
    async processTopologyChange(data) {
        // a single device announced itself - only mark it alive
        if (!data.groups) {
            const ip = data.uuid ? this.getIpOfPlayer(data.uuid) : null;
            if (ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'alive' }, { val: true, ack: true });
            }
            return;
        }
        for (const group of data.groups) {
            const ip = this.getIpOfPlayer(group.uuid);
            if (ip) {
                this.channels[ip].uuid = group.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'alive' }, { val: true, ack: true });
            }
            const members = [];
            const membersChannels = [];
            for (const groupMember of group.members) {
                const memberIp = this.getIpOfPlayer(groupMember.uuid);
                if (memberIp) {
                    this.channels[memberIp].uuid = groupMember.uuid;
                    membersChannels.push(memberIp);
                    await this.setState({ device: 'root', channel: memberIp, state: 'coordinator' }, { val: ip, ack: true });
                }
                if (groupMember.roomName) {
                    members.push(groupMember.roomName);
                }
            }
            if (ip && members.length) {
                await this.setState({ device: 'root', channel: ip, state: 'members' }, { val: members.join(','), ack: true });
            }
            if (ip && membersChannels.length) {
                await this.setState({ device: 'root', channel: ip, state: 'membersChannels' }, { val: membersChannels.join(','), ack: true });
                await this.syncGroupPlayback(ip);
            }
        }
        if (!this.playlistsLoaded && this.backend?.devices?.length) {
            await this.updateMediaLists();
        }
        this.scheduleHomeTheaterHeal();
    }
    async takeSonosQueue(ip, player, queue) {
        const _text = [];
        const _html = [];
        _html.push('<table class="sonosQueueTable">');
        for (let q = 0; q < queue.length; q++) {
            _text.push(`${queue[q].artist} - ${queue[q].title}`);
            _html.push(`
                        <tr class="sonosQueueRow" onclick="vis.setValue('${this.namespace}.root.${player.channel}.current_track_number', ${q + 1})">
                        <td class="sonosQueueTrackNumber">${q + 1}</td>
                        <td class="sonosQueueTrackCover"><img src="${player.baseUrl}${queue[q].albumArtUri}"></td>
                        <td class="sonosQueueTrackArtist">${queue[q].artist}</td>
                        <td class="sonosQueueTrackAlbum">${queue[q].album}</td>
                        <td class="sonosQueueTrackTitle">${queue[q].title}</td>
                        </tr>
                        `);
        }
        _html.push('</table>');
        const qtext = _text.join(', ');
        const qhtml = _html.join('');
        await this.setState({ device: 'root', channel: ip, state: 'queue' }, { val: qtext, ack: true });
        this.log.debug(`queue for ${player.baseUrl}: ${qtext}`);
        await this.setState({ device: 'root', channel: ip, state: 'queue_html' }, { val: qhtml, ack: true });
        this.log.debug(`queue for ${player.baseUrl}: ${qhtml}`);
    }
    /**
     * Find the IP address of a known player and ensure, that a channel for it exists
     *
     * @param uuid UUID of the player
     * @returns the IP address (with underscores) or null if the player or the channel is unknown
     */
    getIpOfPlayer(uuid) {
        const ip = this.backend?.getDeviceByUuid(uuid)?.channel;
        return ip && this.channels[ip] ? ip : null;
    }
    /**
     * Update queue: highlight current track in html-queue
     *
     * @param playerIp IP address (with underscores) of the player
     * @param trackNumber number of the current track
     */
    async updateHtmlQueue(playerIp, trackNumber) {
        // Get current html-queue
        const playerDp = `${this.namespace}.root.${playerIp}`;
        const state = await this.getStateAsync(`${playerDp}.queue_html`);
        if (!state?.val) {
            this.log.debug(`Update html-queue for ${playerIp}: html-queue is empty`);
            return;
        }
        this.log.debug(`Update html-queue for ${playerIp}: current html-queue is ${state.val}`);
        // Remove old highlighting
        let queue = state.val.replace('class="sonosQueueRow currentTrack" id="currentTrack"', 'class="sonosQueueRow"');
        // Get current track number
        this.log.debug(`Update html-queue for ${playerIp}: current track number is ${trackNumber}`);
        // Create RegEx pattern
        const regexPattern = `<tr class="sonosQueueRow" onclick="vis.setValue\\('sonos.[0-9].root.[0-9]{1,3}_[0-9]{1,3}_[0-9]{1,3}_[0-9]{1,3}.current_track_number', ${trackNumber}\\)">`;
        this.log.debug(`Update html-queue for ${playerIp}: RegEx pattern is ${regexPattern}`);
        // Match current track in queue
        const currentTrack = queue.match(new RegExp(regexPattern, 'gm'));
        if (!currentTrack) {
            this.log.debug(`Update html-queue for ${playerIp}: no RegEx match`);
            return;
        }
        this.log.debug(`Update html-queue for ${playerIp}: got match ${currentTrack.toString()}`);
        // Add id and class to current track
        const currentTrackHighlight = currentTrack
            .toString()
            .replace('class="sonosQueueRow"', 'class="sonosQueueRow currentTrack" id="currentTrack"');
        this.log.debug(`Update html-queue for ${playerIp}: new html string for current track is ${currentTrackHighlight}`);
        // Replace html for current track in queue
        queue = queue.replace(currentTrack.toString(), currentTrackHighlight);
        this.log.debug(`Update html-queue ${playerIp}: new queue is ${queue}`);
        // set queue to dp
        await this.setState(`${playerDp}.queue_html`, { val: queue, ack: true });
    }
    async main() {
        this.config.fadeIn = parseInt(String(this.config.fadeIn), 10) || 0;
        this.config.fadeOut = parseInt(String(this.config.fadeOut), 10) || 0;
        await this.syncConfig();
        await this.ensureQuickstarts();
        await this.ensureHomeTheaterState();
        this.cacheDir = path.join(utils.getAbsoluteDefaultDataDir(), 'sonosCache') + path.sep;
        // create directory for cached files
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir);
        }
        // Two client libraries are shipped side by side while the new one is being proven out.
        // A tester who hits a problem flips this setting instead of downgrading the adapter.
        const tokenFile = this.getTokenFile();
        if (this.config.backend === 'svrooij') {
            this.log.info('Using the @svrooij/sonos backend (experimental)');
            this.backend = new svrooij_backend_1.SvrooijBackend({ tokenFile, log: this.log });
        }
        else {
            this.backend = new discovery_backend_1.DiscoveryBackend({
                log: this.log,
                cacheDir: this.cacheDir,
                port: this.config.webserverPort,
                tokenFile,
            });
        }
        const events = [
            'topology-change',
            'transport-state',
            'group-volume',
            'group-mute',
            'volume',
            'mute',
            'favorites',
            // 'treble' and 'bass' are deliberately not subscribed: sonos-discovery never emits
            // them. The backend can deliver them, so a later backend can switch them on.
        ];
        events.forEach(event => this.backend?.on(event, data => this.processSonosEvents(event, data).catch(e => this.log.error(`Cannot process ${event}: ${e}`))));
        // the backend already reads the queue, the adapter only caches it
        this.backend.on('queue', data => {
            this.queues[data.uuid] = data.queue;
            this.processSonosEvents('queue', data).catch(e => this.log.error(`Cannot loadQueue: ${e}`));
        });
        try {
            await this.backend.start();
        }
        catch (e) {
            this.log.error(`Cannot start the SONOS backend: ${e}`);
        }
        this.subscribeStates('*');
        this.scheduleHomeTheaterRefresh();
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new Sonos(options);
}
else {
    // otherwise start the instance directly
    (() => new Sonos())();
}
//# sourceMappingURL=main.js.map