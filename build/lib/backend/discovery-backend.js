"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscoveryBackend = void 0;
/**
 * {@link SonosBackend} on top of the `sonos-discovery` package.
 *
 * This is the only file that knows that library. It translates its player objects and its
 * event names into the adapter's own vocabulary; the behaviour is meant to be identical to
 * what `main.ts` did directly before the facade was introduced.
 */
const sonos_discovery_1 = __importDefault(require("sonos-discovery"));
const content_directory_1 = require("../content-directory");
const smapi_1 = require("../smapi");
/** Event names of the library mapped onto the adapter's own ones */
const EVENT_NAMES = {
    'topology-change': 'topology-change',
    'transport-state': 'transport-state',
    'group-volume': 'group-volume',
    'volume-change': 'volume',
    'group-mute': 'group-mute',
    'mute-change': 'mute',
    favorites: 'favorites',
    'list-change': 'favorites',
};
/**
 * IP address out of the base URL of a player
 *
 * @param baseUrl `http://<ip>:1400`
 * @param underscores replace the dots, so that the result can be used as a channel name
 */
function ipOf(baseUrl, underscores) {
    const match = baseUrl.match(/http:\/\/([.\d]+):?/);
    if (match?.[1]) {
        return underscores ? match[1].replace(/[.\s]+/g, '_') : match[1];
    }
    return null;
}
/** Browse results arrive either as an array or as a dictionary, depending on the call */
function toList(items) {
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
class DiscoveryDevice {
    player;
    backend;
    /** Bookkeeping of this adapter, the library does not maintain it */
    volume = 0;
    /** Bookkeeping of this adapter, the library does not maintain it */
    muted = false;
    uuid;
    ip;
    channel;
    constructor(player, backend) {
        this.player = player;
        this.backend = backend;
        this.uuid = player.uuid;
        this.ip = ipOf(player.baseUrl, false);
        this.channel = ipOf(player.baseUrl, true);
    }
    /** The underlying player, for the backend itself */
    get raw() {
        return this.player;
    }
    get roomName() {
        return this.player.roomName;
    }
    get baseUrl() {
        return this.player.baseUrl;
    }
    get coordinator() {
        const coordinator = this.player.coordinator;
        if (!coordinator || coordinator.uuid === this.uuid) {
            return this;
        }
        return this.backend.getDeviceByUuid(coordinator.uuid) || this;
    }
    get isGroupMember() {
        return Boolean(this.player.coordinator && this.player.coordinator.uuid !== this.uuid);
    }
    get groupMembers() {
        const master = this.coordinator.uuid;
        return this.backend.devices.filter(device => device.coordinator.uuid === master);
    }
    get state() {
        return this.player.state;
    }
    get groupState() {
        return this.player.groupState;
    }
    get transportUri() {
        const av = String(this.player.avTransportUri || '');
        if (av) {
            return av;
        }
        const track = String(this.player.state?.currentTrack?.uri || '');
        return (0, content_directory_1.isTvStreamUri)(track) ? '' : track;
    }
    get transportUriMetadata() {
        return typeof this.player.avTransportUriMetadata === 'string' ? this.player.avTransportUriMetadata : '';
    }
    // playback ------------------------------------------------------------
    async play() {
        await this.player.play();
    }
    async pause() {
        await this.player.pause();
    }
    async next() {
        await this.player.nextTrack();
    }
    async previous() {
        await this.player.previousTrack();
    }
    async seekTime(seconds) {
        await this.player.timeSeek(seconds);
    }
    async seekTrack(trackNo) {
        await this.player.trackSeek(trackNo);
    }
    async setShuffle(enabled) {
        await this.player.shuffle(enabled);
    }
    async setRepeat(mode) {
        await this.player.repeat(mode);
    }
    async setCrossfade(enabled) {
        await this.player.crossfade(enabled);
    }
    // volume and sound ----------------------------------------------------
    async setVolume(volume) {
        await this.player.setVolume(volume);
    }
    async setMute(muted) {
        await (muted ? this.player.mute() : this.player.unMute());
    }
    async setGroupVolume(volume) {
        await this.player.setGroupVolume(volume);
    }
    async setGroupMute(muted) {
        await (muted ? this.player.muteGroup() : this.player.unMuteGroup());
    }
    async setBass(value) {
        await this.player.setBass(value);
    }
    async setTreble(value) {
        await this.player.setTreble(value);
    }
    async setNightMode(enabled) {
        await this.player.nightMode(enabled);
    }
    async setSpeechEnhancement(enabled) {
        await this.player.speechEnhancement(enabled);
    }
    // sources -------------------------------------------------------------
    async setTransportUri(uri, metadata) {
        await this.player.setAVTransport(uri, metadata);
    }
    async playFavorite(title) {
        await this.player.replaceWithFavorite(title);
        await this.player.play();
    }
    async playPlaylist(title) {
        await this.player.replaceWithPlaylist(title);
        await this.player.play();
    }
    // queue ---------------------------------------------------------------
    async getQueue() {
        return await this.player.getQueue();
    }
    async addToQueue(uri, metadata) {
        const result = await this.player.addURIToQueue(uri, metadata);
        return parseInt(String(result?.firsttracknumberenqueued), 10);
    }
    async removeFromQueue(trackNo) {
        await this.player.removeTrackFromQueue(trackNo);
    }
    async clearQueue() {
        await this.player.clearQueue();
    }
    // grouping ------------------------------------------------------------
    async leaveGroup() {
        await this.player.becomeCoordinatorOfStandaloneGroup();
    }
    // browsing ------------------------------------------------------------
    async browse(objectId) {
        return await (0, content_directory_1.browseMedia)(this.baseUrl, objectId);
    }
    async hasTvInput() {
        return await (0, content_directory_1.hasHomeTheater)(this.baseUrl);
    }
    /**
     * The speaker knows the format in two places: `HTAudioIn` of GetZoneInfo carries a code,
     * and the position info carries the `streamContent` the soundbar shows. The first one is
     * authoritative, the second fills in where the code has no label.
     */
    async tvAudioFormat() {
        try {
            const code = (0, content_directory_1.parseHtAudioIn)(await (0, content_directory_1.soapGetZoneInfo)(this.baseUrl));
            if (code != null) {
                if ((0, content_directory_1.isHtAudioSilent)(code)) {
                    return '';
                }
                const label = (0, content_directory_1.htAudioInLabel)(code);
                if (label) {
                    return label;
                }
            }
        }
        catch {
            // fall through to the position info
        }
        try {
            return (0, content_directory_1.tvAudioFormat)((0, content_directory_1.streamContentFromDidl)(await (0, content_directory_1.soapGetPositionInfo)(this.baseUrl)));
        }
        catch {
            return '';
        }
    }
}
class DiscoveryBackend {
    discovery;
    smapi;
    music;
    /** One wrapper per player, so that identity and the bookkeeping survive */
    wrappers = new Map();
    constructor(options) {
        this.discovery = new sonos_discovery_1.default({
            household: null,
            log: options.log,
            cacheDir: options.cacheDir,
            port: options.port,
        });
        this.smapi = new smapi_1.SmapiHub(options.log, options.tokenFile);
        // Which speaker is asked does not matter: the accounts belong to the household.
        const anyBaseUrl = () => this.devices[0]?.baseUrl || '';
        this.music = {
            hasCatalog: name => this.smapi.hasSoapCatalog(anyBaseUrl(), name),
            browse: (name, objectId, german, index) => this.smapi.browse(anyBaseUrl(), name, objectId, german, index),
            search: (name, term, german) => this.smapi.search(anyBaseUrl(), name, term, german),
            completeLogin: name => this.smapi.completeLogin(anyBaseUrl(), name),
        };
    }
    get devices() {
        return (this.discovery.players || []).filter(Boolean).map(player => this.wrap(player));
    }
    get musicServices() {
        return this.discovery.availableServices || {};
    }
    get localEndpoint() {
        return this.discovery.localEndpoint;
    }
    wrap(player) {
        let wrapper = this.wrappers.get(player.uuid);
        if (!wrapper) {
            wrapper = new DiscoveryDevice(player, this);
            this.wrappers.set(player.uuid, wrapper);
        }
        return wrapper;
    }
    /** `sonos-discovery` starts discovering in its constructor, so there is nothing to await. */
    start() {
        return Promise.resolve();
    }
    getDeviceByUuid(uuid) {
        const player = this.discovery.getPlayerByUUID(uuid);
        return player ? this.wrap(player) : undefined;
    }
    getDeviceByChannel(channel) {
        return this.devices.find(device => device.channel === channel);
    }
    async getFavorites() {
        return toList(await this.discovery.getFavorites());
    }
    async getPlaylists() {
        if (!this.discovery.getPlaylists) {
            return [];
        }
        return toList(await this.discovery.getPlaylists());
    }
    on(event, listener) {
        const emit = (data) => listener(data);
        // "transport-state" carries the player object itself. Reduce it to uuid and state, so
        // that no object of the library reaches the adapter.
        if (event === 'transport-state') {
            this.discovery.on('transport-state', (player) => {
                if (player?.uuid) {
                    emit({ uuid: player.uuid, state: player.state });
                }
            });
            return;
        }
        // "topology-change" is either the list of groups or the single device that announced
        // itself. Both shapes get a name here instead of being told apart by `data.length`.
        if (event === 'topology-change') {
            this.discovery.on('topology-change', (data) => {
                if (Array.isArray(data)) {
                    emit({
                        groups: data.map(group => ({
                            uuid: group.uuid,
                            members: (group.members || []).map((member) => ({
                                uuid: member.uuid,
                                roomName: member.roomName,
                            })),
                        })),
                    });
                }
                else if (data?.uuid) {
                    emit({ uuid: data.uuid });
                }
            });
            return;
        }
        // The queue is not part of the event payload, so it is fetched here and the adapter
        // gets the same shape as for every other event.
        if (event === 'queue') {
            this.discovery.on('queue-change', (player) => {
                if (!player) {
                    return;
                }
                player
                    .getQueue()
                    .then((queue) => emit({ uuid: player.uuid, queue }))
                    .catch(() => {
                    // a failing queue read must not kill the listener
                });
            });
            return;
        }
        // treble and bass are emitted under their own names
        if (event === 'treble' || event === 'bass') {
            this.discovery.on(event, emit);
            return;
        }
        Object.keys(EVENT_NAMES)
            .filter(name => EVENT_NAMES[name] === event)
            .forEach(name => this.discovery.on(name, emit));
    }
    dispose() {
        this.wrappers.clear();
        this.discovery.dispose();
    }
}
exports.DiscoveryBackend = DiscoveryBackend;
//# sourceMappingURL=discovery-backend.js.map