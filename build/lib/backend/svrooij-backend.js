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
exports.SvrooijBackend = exports.SvrooijDevice = void 0;
exports.toSeconds = toSeconds;
exports.toFormatted = toFormatted;
exports.fromPlayMode = fromPlayMode;
exports.toPlayMode = toPlayMode;
exports.toTrack = toTrack;
/**
 * {@link SonosBackend} on top of `@svrooij/sonos`.
 *
 * The other implementation, `discovery-backend.ts`, wraps a library that keeps an aggregated
 * state per player. This one does not get that for free: `@svrooij/sonos` delivers typed
 * events per device and per service, so the state the adapter needs is assembled here from
 * the AVTransport and RenderingControl events plus a position read.
 */
const os = __importStar(require("node:os"));
const sonos_1 = require("@svrooij/sonos");
const models_1 = require("@svrooij/sonos/lib/models");
const content_directory_1 = require("../content-directory");
const smapi_1 = require("../smapi");
/** `h:mm:ss` into seconds; the speakers answer with that format everywhere */
function toSeconds(time) {
    if (!time) {
        return 0;
    }
    return String(time)
        .split(':')
        .reverse()
        .reduce((sum, part, index) => sum + (parseInt(part, 10) || 0) * Math.pow(60, index), 0);
}
/** Seconds into `h:mm:ss`, the shape the adapter writes into `current_elapsed_s` */
function toFormatted(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const mm = `${minutes}`.padStart(2, '0');
    const ss = `${secs}`.padStart(2, '0');
    return hours ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
/**
 * Shuffle and repeat are one enum here, but two independent states in ioBroker.
 * These two helpers fold and unfold it without losing either.
 */
function fromPlayMode(mode) {
    switch (mode) {
        case models_1.PlayMode.RepeatAll:
            return { shuffle: false, repeat: 'all' };
        case models_1.PlayMode.RepeatOne:
            return { shuffle: false, repeat: 'one' };
        case models_1.PlayMode.Shuffle:
            return { shuffle: true, repeat: 'all' };
        case models_1.PlayMode.ShuffleNoRepeat:
            return { shuffle: true, repeat: 'none' };
        case models_1.PlayMode.SuffleRepeatOne:
            return { shuffle: true, repeat: 'one' };
        default:
            return { shuffle: false, repeat: 'none' };
    }
}
function toPlayMode(shuffle, repeat) {
    if (shuffle) {
        if (repeat === 'one') {
            return models_1.PlayMode.SuffleRepeatOne;
        }
        return repeat === 'all' ? models_1.PlayMode.Shuffle : models_1.PlayMode.ShuffleNoRepeat;
    }
    if (repeat === 'one') {
        return models_1.PlayMode.RepeatOne;
    }
    return repeat === 'all' ? models_1.PlayMode.RepeatAll : models_1.PlayMode.Normal;
}
/** `PLAYING` and friends; the adapter compares against these strings */
function transportState(state) {
    return String(state || 'STOPPED').toUpperCase();
}
/** A parsed track of the library into the adapter's shape */
function toTrack(track, uri) {
    if (!track || typeof track === 'string') {
        return { uri: uri || '', duration: 0 };
    }
    const upnpClass = String(track.UpnpClass || '').toLowerCase();
    const trackUri = track.TrackUri || uri || '';
    let type = 'track';
    if (upnpClass.includes('audiobroadcast')) {
        type = 'radio';
    }
    else if (trackUri.startsWith('x-rincon-stream:') || trackUri.startsWith('x-sonos-htastream:')) {
        type = 'line_in';
    }
    return {
        uri: trackUri,
        title: track.Title || '',
        artist: track.Artist || '',
        album: track.Album || '',
        albumArtUri: track.AlbumArtUri || '',
        duration: toSeconds(track.Duration),
        type,
    };
}
/**
 * Browse results come back as `Result`, which is the parsed track list when the parsing
 * variant of the call was used and the raw DIDL string otherwise.
 */
function toEntries(result) {
    if (!Array.isArray(result?.Result)) {
        return [];
    }
    return result.Result.map(item => ({
        title: item.Title || '',
        uri: item.TrackUri || '',
        albumArtUri: item.AlbumArtUri || '',
        metadata: '',
    }));
}
/** Exported for the tests: the event folding is pure and worth covering directly. */
class SvrooijDevice {
    device;
    backend;
    volume = 0;
    muted = false;
    uuid;
    ip;
    channel;
    /** Assembled from the events; the adapter reads it synchronously */
    cached = {
        currentTrack: { uri: '', duration: 0 },
        playbackState: 'STOPPED',
        elapsedTime: 0,
        elapsedTimeFormatted: '0:00',
        trackNo: 0,
        volume: 0,
        mute: false,
        playMode: { shuffle: false, repeat: 'none', crossfade: false },
        groupState: { volume: 0, mute: false },
        equalizer: {},
    };
    lastTransportUri = '';
    lastTransportMetadata = '';
    /** The hardware does not change, so the probe is answered once */
    homeTheater;
    constructor(device, backend) {
        this.device = device;
        this.backend = backend;
        this.uuid = device.Uuid;
        this.ip = device.Host;
        this.channel = device.Host ? device.Host.replace(/[.\s]+/g, '_') : null;
    }
    get roomName() {
        return this.device.Name;
    }
    get baseUrl() {
        return `http://${this.device.Host}:${this.device.Port}`;
    }
    get coordinator() {
        const uuid = this.device.Coordinator?.Uuid;
        if (!uuid || uuid === this.uuid) {
            return this;
        }
        return this.backend.getDeviceByUuid(uuid) || this;
    }
    get isGroupMember() {
        return Boolean(this.device.Coordinator && this.device.Coordinator.Uuid !== this.uuid);
    }
    get groupMembers() {
        const master = this.coordinator.uuid;
        return this.backend.devices.filter(item => item.coordinator.uuid === master);
    }
    get state() {
        return this.cached;
    }
    get groupState() {
        return this.cached.groupState || { volume: 0, mute: false };
    }
    get transportUri() {
        return this.lastTransportUri || this.cached.currentTrack.uri || '';
    }
    get transportUriMetadata() {
        return this.lastTransportMetadata;
    }
    /**
     * Fold an AVTransport event into the cached state.
     *
     * These events are partial: the speaker sends only what changed. Every field is therefore
     * kept unless the event actually carries it - overwriting with a default would make the
     * states flap, for instance back to STOPPED while playback continues.
     */
    applyTransportEvent(data) {
        if (data.AVTransportURI !== undefined) {
            this.lastTransportUri = String(data.AVTransportURI);
        }
        // The library hands this over parsed whenever it can, but TTS has to put the exact
        // DIDL back after an announcement, so a parsed track is turned back into a string.
        if (data.AVTransportURIMetaData !== undefined) {
            this.lastTransportMetadata =
                typeof data.AVTransportURIMetaData === 'string'
                    ? data.AVTransportURIMetaData
                    : sonos_1.MetaDataHelper.TrackToMetaData(data.AVTransportURIMetaData, true);
        }
        const next = { ...this.cached };
        if (data.CurrentTrackMetaData !== undefined || data.CurrentTrackURI !== undefined) {
            next.currentTrack = toTrack(data.CurrentTrackMetaData, data.CurrentTrackURI);
        }
        if (data.NextTrackMetaData !== undefined) {
            next.nextTrack = toTrack(data.NextTrackMetaData);
        }
        if (data.CurrentPlayMode !== undefined || data.CurrentCrossfadeMode !== undefined) {
            const mode = fromPlayMode(data.CurrentPlayMode ??
                toPlayMode(Boolean(this.cached.playMode?.shuffle), this.cached.playMode?.repeat || 'none'));
            next.playMode = {
                shuffle: mode.shuffle,
                repeat: mode.repeat,
                crossfade: data.CurrentCrossfadeMode ?? Boolean(this.cached.playMode?.crossfade),
            };
        }
        if (data.TransportState !== undefined) {
            next.playbackState = transportState(data.TransportState);
        }
        if (data.CurrentTrack !== undefined) {
            next.trackNo = data.CurrentTrack;
        }
        this.cached = next;
    }
    /** Fold a RenderingControl event into the cached state */
    applyRenderingEvent(data) {
        const volume = data.Volume?.Master;
        const mute = data.Mute?.Master;
        this.cached = {
            ...this.cached,
            volume: volume ?? this.cached.volume,
            mute: mute ?? this.cached.mute,
            equalizer: {
                ...this.cached.equalizer,
                bass: data.Bass ?? this.cached.equalizer?.bass,
                treble: data.Treble ?? this.cached.equalizer?.treble,
                loudness: data.Loudness ?? this.cached.equalizer?.loudness,
                nightMode: data.NightMode ?? this.cached.equalizer?.nightMode,
                speechEnhancement: data.DialogLevel !== undefined
                    ? data.DialogLevel === '1' || String(data.DialogLevel).toLowerCase() === 'true'
                    : this.cached.equalizer?.speechEnhancement,
            },
        };
        if (volume !== undefined) {
            this.volume = volume;
        }
        if (mute !== undefined) {
            this.muted = mute;
        }
    }
    /**
     * Read the play position. The events do not carry it, but the adapter needs it for
     * `current_elapsed` and to decide whether the elapsed timer has to run.
     */
    async refreshPosition() {
        try {
            const info = await this.device.AVTransportService.GetPositionInfo();
            const elapsed = toSeconds(info.RelTime);
            this.cached = {
                ...this.cached,
                elapsedTime: elapsed,
                elapsedTimeFormatted: toFormatted(elapsed),
                trackNo: info.Track ?? this.cached.trackNo,
                currentTrack: {
                    ...this.cached.currentTrack,
                    duration: toSeconds(info.TrackDuration) || this.cached.currentTrack.duration,
                },
            };
        }
        catch {
            // a failing position read must not drop the rest of the state
        }
    }
    /** Read the group volume and mute, which have their own service */
    async refreshGroupState() {
        try {
            const [volume, mute] = await Promise.all([
                this.device.GroupRenderingControlService.GetGroupVolume({ InstanceID: 0 }),
                this.device.GroupRenderingControlService.GetGroupMute({ InstanceID: 0 }),
            ]);
            this.cached = {
                ...this.cached,
                groupState: {
                    volume: volume.CurrentVolume ?? 0,
                    mute: Boolean(mute.CurrentMute),
                },
            };
        }
        catch {
            // the group services are not answered by every model
        }
    }
    // playback ------------------------------------------------------------
    async play() {
        await this.device.Play();
    }
    async pause() {
        await this.device.Pause();
    }
    async next() {
        await this.device.Next();
    }
    async previous() {
        await this.device.Previous();
    }
    async seekTime(seconds) {
        await this.device.SeekPosition(toFormatted(Math.max(0, Math.round(seconds))));
    }
    async seekTrack(trackNo) {
        await this.device.SeekTrack(trackNo);
    }
    async setPlayMode(shuffle, repeat) {
        await this.device.AVTransportService.SetPlayMode({
            InstanceID: 0,
            NewPlayMode: toPlayMode(shuffle, repeat),
        });
    }
    async setShuffle(enabled) {
        await this.setPlayMode(enabled, this.cached.playMode?.repeat || 'none');
    }
    async setRepeat(mode) {
        await this.setPlayMode(Boolean(this.cached.playMode?.shuffle), mode);
    }
    async setCrossfade(enabled) {
        await this.device.AVTransportService.SetCrossfadeMode({ InstanceID: 0, CrossfadeMode: enabled });
    }
    // volume and sound ----------------------------------------------------
    async setVolume(volume) {
        await this.device.SetVolume(volume);
    }
    async setMute(muted) {
        await this.device.RenderingControlService.SetMute({ InstanceID: 0, Channel: 'Master', DesiredMute: muted });
    }
    async setGroupVolume(volume) {
        await this.device.GroupRenderingControlService.SetGroupVolume({ InstanceID: 0, DesiredVolume: volume });
    }
    async setGroupMute(muted) {
        await this.device.GroupRenderingControlService.SetGroupMute({ InstanceID: 0, DesiredMute: muted });
    }
    async setBass(value) {
        await this.device.RenderingControlService.SetBass({ InstanceID: 0, DesiredBass: value });
    }
    async setTreble(value) {
        await this.device.RenderingControlService.SetTreble({ InstanceID: 0, DesiredTreble: value });
    }
    async setNightMode(enabled) {
        await this.device.SetNightMode(enabled);
    }
    async setSpeechEnhancement(enabled) {
        await this.device.SetSpeechEnhancement(enabled);
    }
    // sources -------------------------------------------------------------
    async setTransportUri(uri, metadata) {
        await this.device.AVTransportService.SetAVTransportURI({
            InstanceID: 0,
            CurrentURI: uri,
            CurrentURIMetaData: metadata || '',
        });
    }
    /**
     * The library has no "play this favorite by name", so it is composed here: look the entry
     * up, then either point the player at it or put it into the queue - the same decision
     * `replaceWithFavorite` made in the other library.
     */
    async playEntry(entry, what) {
        if (!entry?.uri) {
            throw new Error(`Unknown ${what}`);
        }
        const uri = entry.uri;
        // containers and streams are set directly, single tracks go through the queue
        if (/^(x-rincon-cpcontainer:|x-sonosapi-|x-rincon-mp3radio:|x-sonosprog-http:|pndrradio:|aac:)/i.test(uri)) {
            await this.setTransportUri(uri, entry.metadata);
        }
        else {
            await this.clearQueue();
            await this.addToQueue(uri, entry.metadata);
            await this.device.SwitchToQueue();
        }
        await this.play();
    }
    async playFavorite(title) {
        const favorites = await this.backend.getFavorites();
        await this.playEntry(favorites.find(item => item.title === title), `favorite "${title}"`);
    }
    async playPlaylist(title) {
        const playlists = await this.backend.getPlaylists();
        await this.playEntry(playlists.find(item => item.title === title), `playlist "${title}"`);
    }
    // queue ---------------------------------------------------------------
    async getQueue() {
        const queue = await this.device.GetQueue();
        if (!Array.isArray(queue?.Result)) {
            return [];
        }
        return queue.Result.map(item => ({
            title: item.Title || '',
            artist: item.Artist || '',
            album: item.Album || '',
            albumArtUri: item.AlbumArtUri || '',
            uri: item.TrackUri || '',
        }));
    }
    async addToQueue(uri, metadata) {
        const result = await this.device.AVTransportService.AddURIToQueue({
            InstanceID: 0,
            EnqueuedURI: uri,
            EnqueuedURIMetaData: metadata || '',
            DesiredFirstTrackNumberEnqueued: 0,
            EnqueueAsNext: false,
        });
        return result.FirstTrackNumberEnqueued;
    }
    async removeFromQueue(trackNo) {
        await this.device.AVTransportService.RemoveTrackFromQueue({
            InstanceID: 0,
            ObjectID: `Q:0/${trackNo}`,
            UpdateID: 0,
        });
    }
    async clearQueue() {
        await this.device.AVTransportService.RemoveAllTracksFromQueue();
    }
    // grouping ------------------------------------------------------------
    async leaveGroup() {
        await this.device.AVTransportService.BecomeCoordinatorOfStandaloneGroup();
    }
    // browsing ------------------------------------------------------------
    async browse(objectId) {
        const result = await this.device.ContentDirectoryService.BrowseParsed({
            ObjectID: objectId,
            BrowseFlag: 'BrowseDirectChildren',
            Filter: '*',
            StartingIndex: 0,
            RequestedCount: 200,
            SortCriteria: '',
        });
        if (!Array.isArray(result?.Result)) {
            return [];
        }
        return result.Result.map(item => {
            const uri = item.TrackUri || '';
            const isContainer = String(item.UpnpClass || '')
                .toLowerCase()
                .includes('object.container');
            return (0, content_directory_1.mediaItem)({
                id: item.ItemId || uri || item.Title || '',
                title: item.Title || item.ItemId || '',
                uri,
                artist: item.Artist || '',
                album: item.Album || '',
                cover: item.AlbumArtUri || '',
                // line-in and the TV input are containers by class but playable, not browsable
                folder: isContainer && !uri.startsWith('x-rincon-stream:') && !uri.startsWith('x-sonos-htastream:'),
            });
        });
    }
    async hasTvInput() {
        if (this.homeTheater === undefined) {
            try {
                const info = await this.device.GetZoneInfo();
                // only soundbars and amps report this field at all
                this.homeTheater = typeof info?.HTAudioIn === 'number';
            }
            catch {
                this.homeTheater = false;
            }
        }
        return this.homeTheater;
    }
    /** Same two sources as the other backend: the HTAudioIn code, then the stream content */
    async tvAudioFormat() {
        try {
            const code = (await this.device.GetZoneInfo())?.HTAudioIn;
            if (typeof code === 'number') {
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
            const info = await this.device.AVTransportService.GetPositionInfo();
            const meta = info?.TrackMetaData;
            return (0, content_directory_1.tvAudioFormat)(typeof meta === 'string' ? (0, content_directory_1.streamContentFromDidl)(meta) : '');
        }
        catch {
            return '';
        }
    }
}
exports.SvrooijDevice = SvrooijDevice;
class SvrooijBackend {
    options;
    manager = new sonos_1.SonosManager();
    wrappers = new Map();
    listeners = new Map();
    services = {};
    lastGroups = '';
    endpoint = '';
    smapi;
    music;
    /**
     * `SonosManager.Devices` throws while nothing has been discovered yet, and the adapter asks
     * for the device list at times when that is a perfectly normal state - during unload, or
     * before the first speaker answered.
     */
    get known() {
        try {
            return this.manager.Devices || [];
        }
        catch {
            return [];
        }
    }
    /**
     * `SmapiHub` is this adapter's own SMAPI client and is shared with the other backend.
     * It stays because it reads the accounts the user already linked in the SONOS app out of
     * the speaker, which `@svrooij/sonos` documents that it cannot do.
     */
    constructor(options) {
        this.options = options;
        this.smapi = new smapi_1.SmapiHub(options.log, options.tokenFile);
        const anyBaseUrl = () => this.devices[0]?.baseUrl || '';
        this.music = {
            hasCatalog: name => this.smapi.hasSoapCatalog(anyBaseUrl(), name),
            browse: (name, objectId, german, index) => this.smapi.browse(anyBaseUrl(), name, objectId, german, index),
            search: (name, term, german) => this.smapi.search(anyBaseUrl(), name, term, german),
            completeLogin: name => this.smapi.completeLogin(anyBaseUrl(), name),
        };
    }
    /** Discover the household and start listening. Must be awaited before anything else. */
    async start() {
        await this.manager.InitializeWithDiscovery(10);
        this.known.forEach(device => this.attach(device));
        this.manager.OnNewDevice(device => this.attach(device));
        const any = this.known[0];
        if (any) {
            try {
                const list = await any.MusicServicesService.ListAndParseAvailableServices(true);
                this.services = {};
                list.forEach(service => {
                    this.services[service.Name] = { id: service.Id, type: Number(service.ContainerType) || 0 };
                });
            }
            catch {
                // the household answers this only when it knows any service at all
            }
        }
        this.endpoint = this.resolveLocalEndpoint();
        await this.emitTopology();
    }
    get devices() {
        return this.known.map(device => this.wrap(device));
    }
    get musicServices() {
        return this.services;
    }
    get localEndpoint() {
        return this.options.localEndpoint || this.endpoint;
    }
    /**
     * Address the speakers can reach this host at.
     *
     * `sonos-discovery` worked this out itself; here the interface that shares a subnet with a
     * speaker is picked, so a host with several interfaces answers with the right one.
     */
    resolveLocalEndpoint() {
        const candidates = [];
        Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach(entry => {
            if (entry.family === 'IPv4' && !entry.internal) {
                candidates.push(entry.address);
            }
        }));
        const speaker = this.known[0]?.Host;
        if (speaker) {
            const prefix = speaker.split('.').slice(0, 3).join('.');
            const sameSubnet = candidates.find(address => address.startsWith(`${prefix}.`));
            if (sameSubnet) {
                return sameSubnet;
            }
        }
        return candidates[0] || '127.0.0.1';
    }
    wrap(device) {
        let wrapper = this.wrappers.get(device.Uuid);
        if (!wrapper) {
            wrapper = new SvrooijDevice(device, this);
            this.wrappers.set(device.Uuid, wrapper);
        }
        return wrapper;
    }
    emit(event, data) {
        this.listeners.get(event)?.forEach(listener => listener(data));
    }
    /** Subscribe to everything one device can tell us and translate it */
    attach(device) {
        const wrapper = this.wrap(device);
        device.Events.on('avtransport', data => {
            wrapper.applyTransportEvent(data);
            void wrapper.refreshPosition().then(() => {
                this.emit('transport-state', { uuid: wrapper.uuid, state: wrapper.state });
            });
        });
        device.Events.on('renderingcontrol', data => {
            const hadVolume = data.Volume?.Master !== undefined;
            const hadMute = data.Mute?.Master !== undefined;
            wrapper.applyRenderingEvent(data);
            if (hadVolume) {
                this.emit('volume', {
                    uuid: wrapper.uuid,
                    roomName: wrapper.roomName,
                    newVolume: wrapper.state.volume,
                });
            }
            if (hadMute) {
                this.emit('mute', { uuid: wrapper.uuid, roomName: wrapper.roomName, newMute: wrapper.state.mute });
            }
            if (data.Bass !== undefined) {
                this.emit('bass', { uuid: wrapper.uuid, value: data.Bass });
            }
            if (data.Treble !== undefined) {
                this.emit('treble', { uuid: wrapper.uuid, value: data.Treble });
            }
        });
        // grouping changes arrive per device; the topology is rebuilt from all of them
        device.Events.on('coordinator', () => void this.emitTopology());
        device.Events.on('groupname', () => void this.emitTopology());
    }
    /** Build the group list the adapter expects and emit it when it actually changed */
    async emitTopology() {
        const groups = new Map();
        this.devices.forEach(device => {
            const master = device.coordinator;
            const group = groups.get(master.uuid) || { uuid: master.uuid, members: [] };
            group.members.push({ uuid: device.uuid, roomName: device.roomName });
            groups.set(master.uuid, group);
        });
        const list = [...groups.values()];
        const fingerprint = JSON.stringify(list);
        if (fingerprint === this.lastGroups) {
            return;
        }
        this.lastGroups = fingerprint;
        // the group volume is not evented, so it is refreshed together with the topology
        await Promise.all(this.devices.map(device => device.refreshGroupState()));
        this.emit('topology-change', { groups: list });
    }
    getDeviceByUuid(uuid) {
        const device = this.known.find(item => item.Uuid === uuid);
        return device ? this.wrap(device) : undefined;
    }
    getDeviceByChannel(channel) {
        return this.devices.find(device => device.channel === channel);
    }
    async getFavorites() {
        const device = this.known[0];
        if (!device) {
            return [];
        }
        return toEntries(await device.GetFavorites());
    }
    async getPlaylists() {
        const device = this.known[0];
        if (!device) {
            return [];
        }
        return toEntries(await device.ContentDirectoryService.BrowseParsedWithDefaults('SQ:'));
    }
    on(event, listener) {
        const list = this.listeners.get(event) || [];
        list.push(listener);
        this.listeners.set(event, list);
    }
    dispose() {
        this.manager.CancelSubscription();
        this.known.forEach(device => device.CancelEvents());
        this.wrappers.clear();
    }
}
exports.SvrooijBackend = SvrooijBackend;
//# sourceMappingURL=svrooij-backend.js.map