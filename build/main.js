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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
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
const utils = __importStar(require("@iobroker/adapter-core"));
const sonos_discovery_1 = __importDefault(require("sonos-discovery"));
const tts_1 = require("./lib/tts");
const states_1 = require("./lib/states");
const content_directory_1 = require("./lib/content-directory");
const smapi_1 = require("./lib/smapi");
const ytmusic_1 = require("./lib/ytmusic");
const DEFAULT_IMAGE = `${__dirname}/../img/no-cover.png`;
const TV_IMAGE = `${__dirname}/../img/tv-cover.png`;
const RECENT_TRACKS_MAX = 25;
/** Grouping URI used when a player is a slave (`x-rincon:RINCON_...`) */
function isGroupingUri(uri) {
    return /^x-rincon:RINCON_/i.test(String(uri || ''));
}
/** True if this player is in a group and is not the coordinator */
function isGroupMember(player) {
    return Boolean(player.coordinator && player.coordinator.uuid !== player.uuid);
}
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
 * Extract the IP address of a player out of its base URL
 *
 * @param player sonos player
 * @param noReplace if true, the dots will not be replaced by underscores
 */
function getIp(player, noReplace) {
    const m = player.baseUrl.match(/http:\/\/([.\d]+):?/);
    if (m?.[1]) {
        return noReplace ? m[1] : m[1].replace(/[.\s]+/g, '_');
    }
    return null;
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
    discovery = null;
    smapi = null;
    lastCover = {};
    lastTvFormat = {};
    lastTvFormatFetch = {};
    lastHistoryKey = {};
    cacheDir = '';
    currentFileNum = 0;
    queues = {};
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
                if (this.channels[ip]?.timerVolume) {
                    clearTimeout(this.channels[ip].timerVolume);
                    this.channels[ip].timerVolume = null;
                }
            });
            this.log.info('terminating');
            if (this.discovery) {
                this.discovery.players?.forEach(player => {
                    if (player.tts) {
                        player.tts.destroy();
                        player.tts = null;
                    }
                });
                this.discovery.dispose();
                this.discovery = null;
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
            player = this.discovery?.getPlayerByUUID(this.channels[id.channel].uuid) || null;
            this.channels[id.channel].player = player;
        }
        if (!player) {
            this.log.warn(`SONOS "${id.channel}"/"${this.channels[id.channel].uuid}" not found`);
            this.discovery?.players.forEach(p => this.log.debug(`UUID: ${p.uuid} in ${p.roomName} / ${p.baseUrl}`));
            return;
        }
        // Only grouped members send transport to the master. A standalone room
        // (or the group coordinator itself) always controls its own playback.
        const media = isGroupMember(player) && player.coordinator ? player.coordinator : player;
        const mediaIp = getIp(media) || id.channel;
        let promise;
        if (id.state === 'state_simple') {
            promise = value ? media.play() : media.pause();
        }
        else if (id.state === 'current_track_number') {
            promise = media.trackSeek(value);
        }
        else if (id.state === 'shuffle') {
            promise = media.shuffle(!!value);
        }
        else if (id.state === 'crossfade') {
            promise = media.crossfade(!!value);
        }
        else if (id.state === 'repeat') {
            if (value === 0 || value === '0') {
                promise = media.repeat('none');
            }
            else if (value === 1 || value === '1') {
                promise = media.repeat('all');
            }
            else if (value === 2 || value === '2') {
                promise = media.repeat('one');
            }
            else {
                promise = media.repeat(value);
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
                promise = media.nextTrack();
            }
        }
        else if (id.state === 'prev') {
            if (value) {
                promise = media.previousTrack();
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
            promise = media.timeSeek(Math.round((duration * percent) / 100));
        }
        else if (id.state === 'current_elapsed') {
            promise = media.timeSeek(parseInt(value, 10));
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
            promise = media.timeSeek(seconds);
        }
        else if (id.state === 'muted') {
            promise = value ? player.mute() : player.unMute();
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
                        promise = media.nextTrack();
                        break;
                    case 'previous':
                        promise = media.previousTrack();
                        break;
                    case 'mute':
                        promise = player.mute();
                        break;
                    case 'unmute':
                        promise = player.unMute();
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
                    .replaceWithFavorite(favorite)
                    .then(() => media.play())
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
                    .replaceWithPlaylist(playlist)
                    .then(() => media.play())
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
                promise = player.becomeCoordinatorOfStandaloneGroup();
            }
            else {
                const coordinator = this.getPlayerByName(value);
                promise = coordinator
                    ? player.setAVTransport(`x-rincon:${coordinator.uuid}`)
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
            promise = value ? media.muteGroup() : media.unMuteGroup();
        }
        else if (id.state === 'play_uri') {
            const uri = String(value || '').trim();
            if (uri && !isGroupingUri(uri)) {
                promise = media.setAVTransport(uri).then(() => media.play());
            }
        }
        else if (id.state === 'media_browse') {
            promise = this.handleMediaBrowse(media, mediaIp, String(value || ''));
        }
        else if (id.state === 'media_play') {
            promise = this.handleMediaPlay(media, String(value || ''), player);
        }
        else {
            this.log.warn(`try to control unknown id ${JSON.stringify(id)}`);
        }
        promise?.then(() => this.log.debug('command done')).catch(e => this.log.error(`Cannot execute command: ${e}`));
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
            default:
                this.log.warn(`Unknown command: ${obj.command}`);
                break;
        }
        if (!wait && obj.callback) {
            this.sendTo(obj.from, obj.command, obj.message, obj.callback);
        }
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
    /** Get all devices, that are currently known by the discovery */
    browse() {
        const result = [];
        this.discovery?.players.forEach(player => result.push({
            roomName: player.roomName,
            ip: getIp(player, true),
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
            if (obj?.native && this.discovery) {
                const url = `http${obj.native.secure ? 's' : ''}://${this.discovery.localEndpoint}:${obj.native.port}/files/${this.name}${id}`;
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
        if (!this.discovery) {
            return;
        }
        for (const player of this.discovery.players) {
            player._address = player._address || getIp(player);
            if (sonosIp && player._address !== sonosIp) {
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
        this.forEachPlayer(sonosIp, player => player.tts?.immediatelyStopTTS());
    }
    playOnSonos(uri, sonosUuid, volume) {
        const player = this.discovery?.getPlayerByUUID(sonosUuid);
        if (!player) {
            return;
        }
        player.tts = player.tts || new tts_1.TTS(this, player);
        player.tts.add(uri, volume);
    }
    //////////////////
    // Group management
    getPlayerByName(name) {
        return this.discovery?.players.find(player => player.roomName === name || getIp(player) === name || player._address === name || player.uuid === name);
    }
    addToGroup(playerNameToAdd, coordinator) {
        const coordinatorPlayer = typeof coordinator === 'string' ? this.getPlayerByName(coordinator) : coordinator;
        const playerToAdd = this.getPlayerByName(playerNameToAdd);
        if (!coordinatorPlayer || !playerToAdd) {
            return Promise.reject(new Error(`Cannot add "${playerNameToAdd}" to group: player not found`));
        }
        return playerToAdd.setAVTransport(`x-rincon:${coordinatorPlayer.uuid}`);
    }
    removeFromGroup(leavingName, coordinator) {
        const coordinatorPlayer = typeof coordinator === 'string' ? this.getPlayerByName(coordinator) : coordinator;
        const leavingPlayer = this.getPlayerByName(leavingName);
        if (!coordinatorPlayer || !leavingPlayer) {
            return Promise.reject(new Error(`Cannot remove "${leavingName}" from group: player not found`));
        }
        if (leavingPlayer.coordinator === coordinatorPlayer) {
            return leavingPlayer.becomeCoordinatorOfStandaloneGroup();
        }
        if (coordinatorPlayer.coordinator === leavingPlayer) {
            return coordinatorPlayer.becomeCoordinatorOfStandaloneGroup();
        }
        return Promise.resolve();
    }
    // State of sonos device was changed
    async takeSonosState(ip, sonosState) {
        await this.setState({ device: 'root', channel: ip, state: 'alive' }, { val: true, ack: true });
        const player = this.discovery?.getPlayerByUUID(this.channels[ip].uuid);
        if (!player) {
            this.log.debug(`Cannot find player for ${ip}`);
            return;
        }
        const ps = getPlaybackState(sonosState.playbackState);
        const playMode = sonosState.playMode;
        this.log.debug(`>  playbackState: ${sonosState.playbackState} - ${sonosState.currentTrack?.title || ''}`);
        const stableState = !ps.transitioning;
        // If some stable state
        if (stableState) {
            await this.setState({ device: 'root', channel: ip, state: 'state_simple' }, { val: ps.playing, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'state' }, { val: ps.paused ? 'pause' : ps.playing ? 'play' : 'stop', ack: true });
            // if duration is 0 (type is radio):
            // - no changes expected and a state update is not necessary!
            // - division by 0
            if (ps.playing && this.channels[ip].duration > 0) {
                if (!this.channels[ip].elapsedTimer) {
                    this.channels[ip].elapsedTimer = setInterval(() => this.updateElapsed(ip), this.config.elapsedInterval || 5000);
                }
            }
            else if (this.channels[ip].elapsedTimer) {
                clearInterval(this.channels[ip].elapsedTimer);
                this.channels[ip].elapsedTimer = null;
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
        const meta = typeof player.avTransportUriMetadata === 'string' ? player.avTransportUriMetadata : '';
        let playing = this.playbackDisplay(sonosState, meta);
        if ((0, content_directory_1.isTvStreamUri)(sonosState.currentTrack.uri)) {
            const format = (0, content_directory_1.tvAudioFormat)(playing.artist) || (await this.resolveTvFormat(player, sonosState.currentTrack, meta));
            if (format) {
                playing = { ...playing, artist: format };
            }
        }
        await this.setState({ device: 'root', channel: ip, state: 'current_type' }, { val: playing.type, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_station' }, { val: playing.station, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_title' }, { val: playing.title, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_album' }, { val: playing.album, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_artist' }, { val: playing.artist, ack: true });
        // elapsed time
        await this.setState({ device: 'root', channel: ip, state: 'current_duration' }, { val: sonosState.currentTrack.duration, ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'current_duration_s' }, { val: toFormattedTime(sonosState.currentTrack.duration), ack: true });
        // Track number
        await this.setState({ device: 'root', channel: ip, state: 'current_track_number' }, { val: sonosState.trackNo, ack: true });
        // Update html-queue: highlight current track
        if (player._address) {
            await this.updateHtmlQueue(player._address, sonosState.trackNo);
        }
        const tvCover = (0, content_directory_1.isTvStreamUri)(sonosState.currentTrack.uri);
        const coverKey = tvCover ? 'tv' : sonosState.currentTrack.albumArtUri || '';
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
        if (sonosState.groupState) {
            await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: sonosState.groupState.mute, ack: true });
        }
        if (playMode) {
            await this.setState({ device: 'root', channel: ip, state: 'shuffle' }, { val: playMode.shuffle, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'repeat' }, { val: playMode.repeat === 'all' ? 1 : playMode.repeat === 'one' ? 2 : 0, ack: true });
            await this.setState({ device: 'root', channel: ip, state: 'crossfade' }, { val: playMode.crossfade, ack: true });
        }
        if (player.tts) {
            if (stableState && (ps.paused || ps.stopped)) {
                player.tts.playingEnded();
            }
            else if (ps.playing) {
                player.tts.playingStarted();
            }
        }
        const coverState = await this.getStateAsync(`root.${ip}.current_cover`);
        const coverUrl = String(coverState?.val || '');
        const isCoordinator = !player.coordinator || player.coordinator.uuid === player.uuid;
        if (!player.tts && (isCoordinator || !isGroupingUri(sonosState.currentTrack.uri))) {
            await this.appendRecentTrack(ip, sonosState, coverUrl);
        }
        if (isCoordinator && !player.tts) {
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
    async resolveTvFormat(player, track, metadata) {
        const fromEvent = (0, content_directory_1.tvAudioFormat)(track.title) || (0, content_directory_1.tvAudioFormat)((0, content_directory_1.streamContentFromDidl)(metadata)) || (0, content_directory_1.tvAudioFormat)(track.artist);
        if (fromEvent) {
            this.lastTvFormat[player.uuid] = fromEvent;
            return fromEvent;
        }
        const now = Date.now();
        if ((this.lastTvFormatFetch[player.uuid] || 0) + 4000 > now) {
            return this.lastTvFormat[player.uuid] || '';
        }
        this.lastTvFormatFetch[player.uuid] = now;
        try {
            const xml = await (0, content_directory_1.soapGetPositionInfo)(player.baseUrl);
            const format = (0, content_directory_1.tvAudioFormat)((0, content_directory_1.streamContentFromDidl)(xml));
            if (format) {
                this.lastTvFormat[player.uuid] = format;
            }
            return format || this.lastTvFormat[player.uuid] || '';
        }
        catch (err) {
            this.log.debug(`TV stream format: ${err}`);
            return this.lastTvFormat[player.uuid] || '';
        }
    }
    recentKey(sonosState, metadata) {
        const playing = this.playbackDisplay(sonosState, metadata);
        return `${playing.title}|${playing.artist}|${playing.album}`;
    }
    async appendRecentTrack(ip, sonosState, coverUrl) {
        const playing = this.playbackDisplay(sonosState);
        const title = playing.title.trim();
        if (!title || !this.channels[ip] || isGroupingUri(sonosState.currentTrack.uri)) {
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
        const entry = {
            title,
            artist: playing.artist,
            album: playing.album,
            station: playing.station,
            cover: coverUrl,
            uri: sonosState.currentTrack.uri || '',
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
        const player = uuid ? this.discovery?.getPlayerByUUID(uuid) : undefined;
        if (!player || player.tts || !player.state?.currentTrack) {
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
        const services = this.discovery?.availableServices || {};
        const key = Object.keys(services).find(item => item.toLowerCase() === name.toLowerCase());
        if (key) {
            return services[key];
        }
        if (name.toLowerCase() === 'spotify') {
            return { id: 9, type: 2311 };
        }
        if (name.toLowerCase().includes('youtube')) {
            return { id: 284, type: 72711 };
        }
        return undefined;
    }
    getSmapi() {
        if (!this.smapi) {
            let dir = path.join('/tmp', this.namespace);
            try {
                dir = utils.getAbsoluteInstanceDataDir(this);
            }
            catch {
                // unit tests / missing controller paths
            }
            this.smapi = new smapi_1.SmapiHub(this.log, path.join(dir, 'smapi-tokens.json'));
        }
        return this.smapi;
    }
    /**
     * Spotify catalog via SMAPI; YouTube Music and similar via saved Sonos
     * favorites, playlists and recently played tracks (Google does not expose
     * that catalog to third-party controllers).
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
            const smapi = await this.getSmapi().browse(player.baseUrl, serviceName, 'root', german);
            items.push(...smapi.items.filter(matchesQuery));
            loginUrl = smapi.loginUrl;
            loginHint = smapi.loginHint;
        }
        catch (err) {
            this.log.warn(`SMAPI browse ${serviceName}: ${err}`);
        }
        try {
            const favorites = this.toFavoriteList(await this.discovery?.getFavorites());
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
            if (this.discovery?.getPlaylists) {
                const playlists = this.toFavoriteList(await this.discovery.getPlaylists());
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
            const recents = await this.loadRecentTracks(player._address || getIp(player));
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
    async handleMediaBrowse(player, ip, objectId) {
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
            result = (0, content_directory_1.getMediaRoot)(this.discovery?.availableServices, labels, player.uuid);
            result.title = german ? 'Quellen' : 'Sources';
        }
        else if (id.startsWith('smapi-search:')) {
            const rest = id.slice('smapi-search:'.length);
            const colon = rest.indexOf(':');
            const name = decodeURIComponent(colon === -1 ? rest : rest.slice(0, colon));
            const term = decodeURIComponent(colon === -1 ? '' : rest.slice(colon + 1));
            try {
                if (await this.getSmapi().hasSoapCatalog(player.baseUrl, name)) {
                    const smapi = await this.getSmapi().search(player.baseUrl, name, term, german);
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
                    const sn = await this.getSmapi().accountSerial(player.baseUrl, 284);
                    let catalog = [];
                    let hint;
                    try {
                        const ytm = await (0, ytmusic_1.searchYoutubeMusic)(term, sn, german);
                        catalog = ytm.items;
                        hint = ytm.hint;
                    }
                    catch (err) {
                        this.log.warn(`YouTube Music search: ${err}`);
                    }
                    const local = await this.listServiceLibrary(player, name, german, term);
                    const localItems = (local.items || []).filter(item => item.favorite || item.playlist || item.uri);
                    const items = [...catalog, ...localItems];
                    result = {
                        id,
                        title: term || name,
                        items: items.length
                            ? items
                            : [
                                (0, content_directory_1.mediaItem)({
                                    id: '',
                                    title: german ? `Keine Treffer für „${term}“.` : `No matches for “${term}”.`,
                                }),
                            ],
                        serviceName: name,
                        searchable: true,
                        loginHint: hint || local.loginHint,
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
            const ok = await this.getSmapi().completeLogin(player.baseUrl, name);
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
                    const smapi = await this.getSmapi().browse(player.baseUrl, parsed.serviceName, parsed.itemId, german);
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
                result = { id, title: id, items: await (0, content_directory_1.browseMedia)(player.baseUrl, id) };
            }
            catch (err) {
                this.log.warn(`Cannot browse media ${id}: ${err.message || err}`);
                result = { id, title: id, items: [] };
            }
        }
        await this.setState({ device: 'root', channel: ip, state: 'media_browse_result' }, { val: JSON.stringify(result), ack: true });
    }
    async handleMediaPlay(player, raw, sourcePlayer) {
        let uri = '';
        let metadata = '';
        const text = raw.trim();
        if (!text) {
            return;
        }
        if (text.startsWith('{')) {
            try {
                const parsed = JSON.parse(text);
                if (parsed.favorite) {
                    await player.replaceWithFavorite(parsed.favorite);
                    await player.play();
                    return;
                }
                if (parsed.playlist) {
                    await player.replaceWithPlaylist(parsed.playlist);
                    await player.play();
                    return;
                }
                if (parsed.tv) {
                    uri = (0, content_directory_1.tvStreamUri)(sourcePlayer?.uuid || player.uuid);
                    metadata = String(parsed.metadata || '');
                }
                else {
                    uri = String(parsed.uri || '').trim();
                    metadata = String(parsed.metadata || '');
                }
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
        if ((0, content_directory_1.isDirectPlayUri)(uri)) {
            await player.setAVTransport(uri, metadata);
            await player.play();
            return;
        }
        await player.clearQueue();
        await player.addURIToQueue(uri, metadata);
        await player.setAVTransport(`x-rincon-queue:${player.uuid}#0`);
        await player.play();
    }
    /** Players that currently share playback with this coordinator (includes itself) */
    getGroupMemberIps(coordinatorIp) {
        const channel = this.channels[coordinatorIp];
        const player = channel?.player || (channel?.uuid ? this.discovery?.getPlayerByUUID(channel.uuid) : undefined);
        if (!player) {
            return [coordinatorIp];
        }
        const master = isGroupMember(player) && player.coordinator ? player.coordinator : player;
        const ips = [];
        for (const item of this.discovery?.players || []) {
            const itemMaster = isGroupMember(item) && item.coordinator ? item.coordinator : item;
            if (itemMaster.uuid !== master.uuid) {
                continue;
            }
            const ip = getIp(item);
            if (ip && this.channels[ip]) {
                ips.push(ip);
            }
        }
        return ips.length ? ips : [coordinatorIp];
    }
    /** Update the elapsed time while playing */
    updateElapsed(ip) {
        const channel = this.channels[ip];
        if (!channel || channel.duration <= 0) {
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
        const player = this.discovery?.getPlayerByUUID(this.channels[ip].uuid);
        const hostname = player ? getIp(player, true) : null;
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
    /** Normalize browse results from sonos-discovery (array or dictionary) */
    toFavoriteList(items) {
        if (!items) {
            return [];
        }
        if (Array.isArray(items)) {
            return items;
        }
        return Object.keys(items)
            .map(key => items[key])
            .filter((item) => Boolean(item));
    }
    async takeSonosFavorites(ip, favorites) {
        let sFavorites = '';
        const aFavorites = [];
        const _hFavorites = [];
        _hFavorites.push('<table class="sonosFavoriteTable">');
        this.toFavoriteList(favorites).forEach((favorite, index) => {
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
        if (!this.discovery) {
            return;
        }
        const favorites = await this.discovery.getFavorites();
        // Go through all players
        for (const player of this.discovery.players) {
            if (!player) {
                continue;
            }
            player._address = player._address || getIp(player);
            const ip = player._address;
            if (ip && this.channels[ip]) {
                await this.takeSonosFavorites(ip, favorites);
            }
        }
    }
    async takeSonosPlaylists(ip, playlists) {
        const names = this.toFavoriteList(playlists)
            .map(item => item.title)
            .filter((title) => Boolean(title));
        await this.setState({ device: 'root', channel: ip, state: 'playlist_list' }, { val: names.join(', '), ack: true });
        await this.setState({ device: 'root', channel: ip, state: 'playlist_list_array' }, { val: JSON.stringify(names), ack: true });
    }
    /** Read Sonos playlists and write them to all known players */
    async updatePlaylists() {
        if (!this.discovery?.getPlaylists) {
            return;
        }
        const playlists = await this.discovery.getPlaylists();
        for (const player of this.discovery.players) {
            if (!player) {
                continue;
            }
            player._address = player._address || getIp(player);
            const ip = player._address;
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
        if (!this.discovery) {
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
            const source = this.discovery.getPlayerByUUID(data.uuid);
            const masterUuid = (source && isGroupMember(source) && source.coordinator ? source.coordinator : source)
                ?.uuid;
            for (const player of this.discovery.players) {
                const itemMaster = isGroupMember(player) && player.coordinator ? player.coordinator : player;
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
            const player = this.discovery.getPlayerByUUID(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: data.newMute, ack: true });
                player._isMuted = data.newMute;
                this.log.debug(`mute: Mute for ${player.baseUrl}: ${data.newMute}`);
                await this.setState({ device: 'root', channel: ip, state: 'group_muted' }, { val: player.groupState.mute, ack: true });
                this.log.debug(`group_muted: groupMuted for ${player.baseUrl}: ${player.groupState.mute}`);
            }
        }
        else if (event === 'volume') {
            const player = this.discovery.getPlayerByUUID(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'volume' }, { val: data.newVolume, ack: true });
                player._volume = data.newVolume;
                this.log.debug(`volume: Volume for ${player.baseUrl}: ${data.newVolume}`);
            }
        }
        else if (event === 'treble' || event === 'bass') {
            // node-sonos-discovery is not emitting any events on treble/bass changes yet, so it is not
            // possible to get the externally set values, yet.
        }
        else if (event === 'mute') {
            const player = this.discovery.getPlayerByUUID(data.uuid);
            const ip = this.getIpOfPlayer(data.uuid);
            if (player && ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'muted' }, { val: data.newMute, ack: true });
                player._isMuted = data.newMute;
                this.log.debug(`mute: Mute for ${player.baseUrl}: ${data.newMute}`);
            }
        }
        else if (event === 'favorites') {
            await this.updateMediaLists();
        }
        else if (event === 'queue') {
            const player = this.discovery.getPlayerByUUID(data.uuid);
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
        if (typeof data.length === 'undefined') {
            const ip = this.getIpOfPlayer(data.uuid);
            if (ip) {
                this.channels[ip].uuid = data.uuid;
                await this.setState({ device: 'root', channel: ip, state: 'alive' }, { val: true, ack: true });
            }
            return;
        }
        for (const group of data) {
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
        if (!this.playlistsLoaded && this.discovery?.players?.length) {
            await this.updateMediaLists();
        }
    }
    async takeSonosQueue(ip, player, queue) {
        const _text = [];
        const _html = [];
        _html.push('<table class="sonosQueueTable">');
        for (let q = 0; q < queue.length; q++) {
            _text.push(`${queue[q].artist} - ${queue[q].title}`);
            _html.push(`
                        <tr class="sonosQueueRow" onclick="vis.setValue('${this.namespace}.root.${player._address}.current_track_number', ${q + 1})">
                        <td class="sonosQueueTrackNumber">${q + 1}</td>
                        <td class="sonosQueueTrackCover"><img src="${player.baseUrl}${queue[q].albumArtUri}"></td>
                        <td class="sonosQueueTrackArtist">${queue[q].artist}</td>
                        <td class="sonosQueueTrackAlbum">${queue[q].album}</td>
                        <td class="sonosQueueTrackTitle">${queue[q].title}</td>
                        </tr>
                        `);
        }
        _html.push('</table>');
        // Add script for auto-scroll playlist
        _html.push(`
                    <script>
                    let element = document.getElementById("currentTrack");
                    if (element != undefined) element.scrollIntoView({behavior: "auto", block: "start", inline: "nearest"});
                    </script>
                    `);
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
        const player = this.discovery?.getPlayerByUUID(uuid);
        if (!player) {
            return null;
        }
        player._address = player._address || getIp(player);
        const ip = player._address;
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
        this.cacheDir = path.join(utils.getAbsoluteDefaultDataDir(), 'sonosCache') + path.sep;
        // create directory for cached files
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir);
        }
        this.discovery = new sonos_discovery_1.default({
            household: null,
            log: this.log,
            cacheDir: this.cacheDir,
            port: this.config.webserverPort,
        });
        // from here the code is mostly from https://github.com/jishi/node-sonos-web-controller/blob/master/server.js
        const events = {
            'topology-change': 'topology-change',
            'transport-state': 'transport-state',
            'group-volume': 'group-volume',
            'volume-change': 'volume',
            'group-mute': 'group-mute',
            'mute-change': 'mute',
            favorites: 'favorites',
            'list-change': 'favorites',
        };
        Object.keys(events).forEach(sonosEvent => this.discovery?.on(sonosEvent, data => this.processSonosEvents(events[sonosEvent], data).catch(e => this.log.error(`Cannot process ${sonosEvent}: ${e}`))));
        this.discovery.on('queue-change', (player) => player
            .getQueue()
            .then(queue => {
            this.queues[player.uuid] = queue;
            return this.processSonosEvents('queue', { uuid: player.uuid, queue });
        })
            .catch(e => this.log.error(`Cannot loadQueue: ${e}`)));
        this.subscribeStates('*');
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