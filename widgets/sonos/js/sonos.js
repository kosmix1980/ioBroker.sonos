'use strict';

/* global vis, jQuery */

window.vis = window.vis || {};
vis.binds = vis.binds || {};

(function ($) {
    if (typeof $ !== 'function') {
        console.error('sonos widget: jQuery is not available');
        return;
    }

    vis.binds.sonos = {
        version: '4.0.3',
        _bound: {},
        _tickers: {},
        words: {
            en: {
                hint: 'Set the object to the Sonos instance, e.g. sonos.0',
                noPlayers: 'No players found. Check the adapter objects under sonos.x.root.',
                rooms: 'Rooms',
                group: 'Group',
                dissolve: 'Ungroup',
                favorites: 'Favorites',
                playlists: 'Playlists',
                queue: 'Queue',
                recent: 'Recent',
                sources: 'Sources',
                back: 'Back',
                emptyFavorites: 'No favorites. Add them in the Sonos app first.',
                emptyPlaylists: 'No playlists. Create them in the Sonos app first.',
                emptyQueue: 'Queue is empty.',
                emptyRecent: 'No recent tracks yet. They appear after something is played.',
                emptySources: 'No entries in this folder.',
                radio: 'TuneIn Radio',
                library: 'Music library',
                shares: 'Network shares',
                lineIn: 'Line-In',
                tv: 'TV',
                tvHdmi: 'HDMI',
                search: 'Search…',
                searchGo: 'Search',
                noSearchHits: 'No matching titles.',
                signedIn: 'Signed in',
                loginOpen: 'Open this link in a browser to connect the music service.',
                unknown: 'Unknown room',
                nothing: 'Nothing playing',
                nightSound: 'Night sound',
                speechEnhance: 'Speech enhancement',
                quickEmpty: 'Free',
                quickSave: 'Save what is playing',
                quickPlay: 'Play',
                quickEdit: 'Edit shortcut',
                quickReplace: 'Replace with current',
                quickRename: 'Save name',
                quickClear: 'Clear',
                quickNothing: 'Nothing is playing that can be saved.',
            },
            de: {
                hint: 'Als Objekt die Sonos-Instanz setzen, z. B. sonos.0',
                noPlayers: 'Keine Player gefunden. Prüfe die Objekte unter sonos.x.root.',
                rooms: 'Räume',
                group: 'Gruppe',
                dissolve: 'Auflösen',
                favorites: 'Favoriten',
                playlists: 'Playlists',
                queue: 'Warteschlange',
                recent: 'Zuletzt',
                sources: 'Quellen',
                back: 'Zurück',
                emptyFavorites: 'Keine Favoriten. Lege sie zuerst in der Sonos-App an.',
                emptyPlaylists: 'Keine Playlists. Lege sie zuerst in der Sonos-App an.',
                emptyQueue: 'Die Warteschlange ist leer.',
                emptyRecent: 'Noch keine Titel. Die Liste füllt sich beim Abspielen.',
                emptySources: 'In diesem Ordner gibt es keine Einträge.',
                radio: 'TuneIn Radio',
                library: 'Mediathek',
                shares: 'Netzlaufwerke',
                lineIn: 'Line-In',
                tv: 'TV',
                tvHdmi: 'HDMI',
                search: 'Suchen…',
                searchGo: 'Suchen',
                noSearchHits: 'Keine passenden Titel.',
                signedIn: 'Anmeldung abgeschlossen',
                loginOpen: 'Diesen Link im Browser öffnen, um den Dienst zu verbinden.',
                unknown: 'Unbekannter Raum',
                nothing: 'Nichts spielt',
                nightSound: 'Nachtsound',
                speechEnhance: 'Sprachverbesserung',
                quickEmpty: 'Frei',
                quickSave: 'Laufendes Stück speichern',
                quickPlay: 'Abspielen',
                quickEdit: 'Taste bearbeiten',
                quickReplace: 'Durch Aktuelles ersetzen',
                quickRename: 'Name speichern',
                quickClear: 'Löschen',
                quickNothing: 'Gerade läuft nichts, das sich speichern lässt.',
            },
        },

        t: function (key) {
            var lang = String((vis.language || (typeof visConfig !== 'undefined' && visConfig.language) || 'en')).substring(0, 2);
            var pack = vis.binds.sonos.words[lang] || vis.binds.sonos.words.en;
            return pack[key] || vis.binds.sonos.words.en[key] || key;
        },

        createWidget: function (widgetID, view, data, style) {
            var $div = $('#' + widgetID);
            if (!$div.length) {
                return setTimeout(function () {
                    vis.binds.sonos.createWidget(widgetID, view, data, style);
                }, 100);
            }

            var oid = '';
            try {
                oid = (data && data.oid) || (data && data.attr && data.attr('oid')) || '';
            } catch (e) {
                oid = '';
            }

            var instance = vis.binds.sonos.resolveInstance(oid);
            var theme;
            try {
                theme = String((data && data.theme) || (data && data.attr && data.attr('theme')) || 'dark');
            } catch (e) {
                theme = 'dark';
            }
            $div.data('sonos-theme', vis.binds.sonos.normalizeTheme(theme));
            $div.data('sonos-tab', $div.data('sonos-tab') || 'favorites');
            $div.data('sonos-sheet', !!$div.data('sonos-sheet'));
            $div.data('sonos-player', $div.data('sonos-player') || vis.binds.sonos.loadRoom(widgetID, instance) || '');

            vis.binds.sonos.unbind(widgetID);

            if (!instance) {
                $div.html('<div class="' + vis.binds.sonos.themeClass($div) + '"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(vis.binds.sonos.t('hint')) + '</div></div>');
                return;
            }

            var paint = function () {
                try {
                    vis.binds.sonos.render(widgetID, instance);
                    vis.binds.sonos.bindStates(widgetID, instance);
                } catch (err) {
                    $div.html('<div class="' + vis.binds.sonos.themeClass($div) + '"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(String(err)) + '</div></div>');
                }
            };

            paint();
            vis.binds.sonos.loadStates(instance, paint);
        },

        normalizeTheme: function (value) {
            var theme = String(value || '').toLowerCase();
            if (theme === 'light' || theme === 'white' || theme === 'hell') {
                return 'light';
            }
            if (theme === 'midnight' || theme === 'blue') {
                return 'midnight';
            }
            return 'dark';
        },

        themeClass: function ($div) {
            return 'sonos-ctrl sonos-ctrl-theme-' + vis.binds.sonos.normalizeTheme($div && $div.data ? $div.data('sonos-theme') : '');
        },

        resolveInstance: function (oid) {
            oid = String(oid || '').replace(/\.+$/, '');
            if (!oid || oid === 'nothing_selected') {
                return '';
            }
            var match = oid.match(/^(sonos\.\d+)/);
            if (match) {
                return match[1];
            }
            var parts = oid.split('.');
            if (parts.length >= 2) {
                return parts[0] + '.' + parts[1];
            }
            return oid;
        },

        roomKey: function (widgetID, instance) {
            return 'iobroker.sonos.widget.room.' + instance + '.' + widgetID;
        },

        loadRoom: function (widgetID, instance) {
            try {
                return window.localStorage.getItem(vis.binds.sonos.roomKey(widgetID, instance)) || '';
            } catch (e) {
                return '';
            }
        },

        saveRoom: function (widgetID, instance, ip) {
            if (!ip) {
                return;
            }
            try {
                window.localStorage.setItem(vis.binds.sonos.roomKey(widgetID, instance), ip);
            } catch (e) {
                // ignore
            }
        },

        esc: function (value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        val: function (id) {
            if (!id) {
                return '';
            }
            if (vis.states) {
                var value = vis.states[id + '.val'];
                if (value === undefined && vis.states.attr) {
                    value = vis.states.attr(id + '.val');
                }
                if (value !== undefined && value !== null) {
                    return value;
                }
            }
            return '';
        },

        parseList: function (value) {
            if (Array.isArray(value)) {
                return value.filter(Boolean);
            }
            if (value == null || value === '') {
                return [];
            }
            if (typeof value === 'string') {
                try {
                    var parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) {
                        return parsed.filter(Boolean);
                    }
                } catch (e) {
                    // comma-separated fallback
                }
                return value.split(/\s*,\s*/).filter(Boolean);
            }
            return [];
        },

        state: function (playerId, name) {
            return vis.binds.sonos.val(playerId + '.' + name);
        },

        write: function (id, value) {
            if (!id) {
                return;
            }
            vis.setValue(id, value);
        },

        mediaPlayerId: function (player) {
            if (!vis.binds.sonos.isGroupMember(player)) {
                return player.id;
            }
            var coord = String(vis.binds.sonos.state(player.id, 'coordinator') || '').trim();
            return player.id.replace(/\.[^.]+$/, '.' + coord);
        },

        isGroupMember: function (player) {
            var coord = String(vis.binds.sonos.state(player.id, 'coordinator') || '').trim();
            return Boolean(coord && coord !== player.ip && coord !== 'null' && coord !== 'undefined');
        },

        findPlayers: function (instance) {
            var prefix = instance + '.root.';
            var seen = {};
            var players = [];

            function add(id, name) {
                if (!id || id.indexOf(prefix) !== 0) {
                    return;
                }
                var rest = id.substring(prefix.length);
                var ip = rest.split('.')[0];
                if (!ip || seen[ip]) {
                    return;
                }
                seen[ip] = true;
                var obj = vis.objects && vis.objects[prefix + ip];
                var label = name;
                if (!label && obj && obj.common && obj.common.name) {
                    label = obj.common.name;
                    if (label && typeof label === 'object') {
                        label = label[vis.language] || label.de || label.en || ip;
                    }
                }
                players.push({
                    ip: ip,
                    id: prefix + ip,
                    name: label || vis.binds.sonos.t('unknown'),
                });
            }

            if (vis.objects) {
                Object.keys(vis.objects).forEach(function (id) {
                    var obj = vis.objects[id];
                    if (!obj || id.indexOf(prefix) !== 0) {
                        return;
                    }
                    var rest = id.substring(prefix.length);
                    if (rest.indexOf('.') === -1 && (obj.type === 'channel' || (obj.common && obj.common.role === 'media.music'))) {
                        add(id);
                    }
                });
            }

            var states = vis.states || {};
            Object.keys(states).forEach(function (key) {
                if (key.indexOf(prefix) !== 0) {
                    return;
                }
                var id = key.replace(/\.(val|ts|ack|lc|q|from|user|expire)$/, '');
                var parts = id.split('.');
                if (parts.length >= 4) {
                    add(parts.slice(0, 4).join('.'));
                }
            });

            players.sort(function (a, b) {
                return String(a.name).localeCompare(String(b.name), vis.language || undefined);
            });
            return players;
        },

        applyStates: function (data) {
            if (!data || !vis.states) {
                return;
            }
            Object.keys(data).forEach(function (id) {
                var state = data[id];
                if (!state || id.indexOf('.') === -1) {
                    return;
                }
                try {
                    if (vis.states.attr) {
                        vis.states.attr(id + '.val', state.val);
                        vis.states.attr(id + '.ack', state.ack);
                        vis.states.attr(id + '.ts', state.ts);
                    } else {
                        vis.states[id + '.val'] = state.val;
                    }
                } catch (e) {
                    vis.states[id + '.val'] = state.val;
                }
            });
        },

        rememberChannel: function (id, obj) {
            if (!id) {
                return;
            }
            vis.objects = vis.objects || {};
            if (!vis.objects[id]) {
                vis.objects[id] = obj || { type: 'channel', common: { name: id.split('.').pop() } };
            }
        },

        loadStates: function (instance, done) {
            var prefix = instance + '.root.';
            var finished = false;
            var finish = function () {
                if (finished) {
                    return;
                }
                finished = true;
                if (typeof done === 'function') {
                    done();
                }
            };

            setTimeout(finish, 600);

            var afterChannels = function () {
                var players = vis.binds.sonos.findPlayers(instance);
                var ids = [];
                players.forEach(function (player) {
                    [
                        'alive',
                        'state',
                        'volume',
                        'muted',
                        'night_mode',
                        'speech_enhancement',
                        'current_title',
                        'current_artist',
                        'current_album',
                        'current_station',
                        'current_type',
                        'current_cover',
                        'current_art',
                        'current_elapsed_s',
                        'current_duration_s',
                        'current_track_number',
                        'seek',
                        'shuffle',
                        'repeat',
                        'coordinator',
                        'membersChannels',
                        'group_volume',
                        'favorites_list_array',
                        'favorites_list',
                        'favorites_list_html',
                        'playlist_list_array',
                        'playlist_list',
                        'queue',
                        'queue_html',
                        'recent_tracks',
                        'media_browse_result',
                        'current_uri',
                        'current_metadata',
                    ].forEach(function (name) {
                        ids.push(player.id + '.' + name);
                    });
                });
                ids.push(instance + '.quickstarts');

                if (!vis.conn || typeof vis.conn.getStates !== 'function') {
                    finish();
                    return;
                }

                var onStates = function (error, data) {
                    vis.binds.sonos.applyStates(data);
                    if (typeof vis.conn.subscribe === 'function' && ids.length) {
                        try {
                            vis.conn.subscribe(ids);
                        } catch (e) {
                            // ignore
                        }
                    }
                    finish();
                };

                try {
                    if (ids.length) {
                        vis.conn.getStates(ids, onStates);
                    } else {
                        vis.conn.getStates(onStates);
                    }
                } catch (e) {
                    finish();
                }
            };

            var onChannels = function (error, result) {
                var rows = (result && result.rows) || [];
                rows.forEach(function (row) {
                    var id = row.id || row._id;
                    if (!id || id.indexOf(prefix) !== 0) {
                        return;
                    }
                    if (id.substring(prefix.length).indexOf('.') !== -1) {
                        return;
                    }
                    vis.binds.sonos.rememberChannel(id, row.value);
                });
                afterChannels();
            };

            try {
                if (vis.conn && typeof vis.conn.getObjectView === 'function') {
                    vis.conn.getObjectView('system', 'channel', { startkey: prefix, endkey: prefix + '\u9999' }, onChannels);
                    return;
                }
                var socket = vis.conn && (vis.conn._socket || vis.conn.socket);
                if (socket && typeof socket.emit === 'function') {
                    socket.emit('getObjectView', 'system', 'channel', { startkey: prefix, endkey: prefix + '\u9999' }, onChannels);
                    return;
                }
            } catch (e) {
                // fall through
            }

            afterChannels();
        },

        parseTime: function (value) {
            var parts = String(value == null ? '' : value).split(':');
            var sec = 0;
            if (parts.length === 3) {
                sec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
            } else if (parts.length === 2) {
                sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
            } else {
                sec = parseFloat(parts[0]);
            }
            return isNaN(sec) ? 0 : sec;
        },

        formatTime: function (sec) {
            sec = Math.max(0, Math.floor(sec || 0));
            var hours = Math.floor(sec / 3600);
            var min = Math.floor((sec % 3600) / 60);
            var rest = sec % 60;
            var mm = (min < 10 ? '0' : '') + min;
            var ss = (rest < 10 ? '0' : '') + rest;
            return hours ? hours + ':' + mm + ':' + ss : mm + ':' + ss;
        },

        stopTicker: function (widgetID) {
            if (vis.binds.sonos._tickers[widgetID]) {
                clearInterval(vis.binds.sonos._tickers[widgetID]);
                vis.binds.sonos._tickers[widgetID] = null;
            }
        },

        startTicker: function (widgetID, instance) {
            vis.binds.sonos.stopTicker(widgetID);
            vis.binds.sonos._tickers[widgetID] = setInterval(function () {
                var $div = $('#' + widgetID);
                if (!$div.length) {
                    vis.binds.sonos.stopTicker(widgetID);
                    return;
                }
                vis.binds.sonos.patchLive($div, instance);
            }, 500);
        },

        unbind: function (widgetID) {
            var bound = vis.binds.sonos._bound[widgetID] || [];
            bound.forEach(function (item) {
                try {
                    vis.states.unbind(item.id, item.handler);
                } catch (e) {
                    // ignore
                }
            });
            vis.binds.sonos._bound[widgetID] = [];
            $(document).off('mousedown.sonosSheet' + widgetID);
            $(document).off('mousedown.sonosQuick' + widgetID);
        },

        bindStates: function (widgetID, instance) {
            var players = vis.binds.sonos.findPlayers(instance);
            var ids = [];
            players.forEach(function (player) {
                [
                    'alive',
                    'state',
                    'volume',
                    'muted',
                    'night_mode',
                    'speech_enhancement',
                    'current_title',
                    'current_artist',
                    'current_album',
                    'current_station',
                    'current_type',
                    'current_cover',
                    'current_art',
                    'current_elapsed_s',
                    'current_duration_s',
                    'current_track_number',
                    'seek',
                    'shuffle',
                    'repeat',
                    'coordinator',
                    'membersChannels',
                    'group_volume',
                    'favorites_list_array',
                    'favorites_list',
                    'favorites_list_html',
                    'playlist_list_array',
                    'playlist_list',
                    'queue',
                    'queue_html',
                    'recent_tracks',
                    'media_browse_result',
                    'current_uri',
                    'current_metadata',
                ].forEach(function (name) {
                    ids.push(player.id + '.' + name);
                });
            });
            ids.push(instance + '.quickstarts');

            vis.binds.sonos.unbind(widgetID);
            ids.forEach(function (id) {
                var isLight = /\.(current_elapsed_s|seek|volume|group_volume)$/.test(id);
                var handler = function () {
                    if (isLight) {
                        vis.binds.sonos.patchLive($('#' + widgetID), instance);
                    } else {
                        vis.binds.sonos.render(widgetID, instance);
                    }
                };
                try {
                    vis.states.bind(id + '.val', handler);
                    vis.binds.sonos._bound[widgetID].push({ id: id + '.val', handler: handler });
                } catch (e) {
                    // ignore missing canJS keys
                }
            });
        },

        patchLive: function ($div, instance) {
            if (!$div || !$div.length) {
                return;
            }
            var selectedIp = $div.data('sonos-player');
            if (!selectedIp) {
                return;
            }
            var selectedId = instance + '.root.' + selectedIp;
            var playerId = vis.binds.sonos.mediaPlayerId({
                id: selectedId,
                ip: selectedIp,
            });
            var playing = vis.binds.sonos.state(playerId, 'state') === 'play';
            var now = vis.binds.sonos.nowPlaying(playerId);
            if (now.isTv || now.isRadio) {
                return;
            }
            var durationS = vis.binds.sonos.parseTime(vis.binds.sonos.state(playerId, 'current_duration_s'));
            var elapsedS = vis.binds.sonos.parseTime(vis.binds.sonos.state(playerId, 'current_elapsed_s'));
            var seek = parseFloat(vis.binds.sonos.state(playerId, 'seek'));
            if (isNaN(seek)) {
                seek = durationS > 0 ? (elapsedS / durationS) * 100 : 0;
            }

            var stamp = playerId + '|' + playing + '|' + durationS + '|' + elapsedS.toFixed(1);
            var snap = $div.data('sonos-progress') || {};
            if (snap.stamp !== stamp) {
                snap = {
                    stamp: stamp,
                    elapsed: elapsedS,
                    duration: durationS,
                    playing: playing,
                    at: Date.now(),
                };
                $div.data('sonos-progress', snap);
            }

            var elapsed = snap.elapsed;
            if (snap.playing && snap.duration > 0) {
                elapsed = Math.min(snap.duration, snap.elapsed + (Date.now() - snap.at) / 1000);
            }
            var percent = snap.duration > 0 ? (elapsed / snap.duration) * 100 : seek;

            if (!$div.find('.sonos-ctrl-seek-input:focus').length) {
                $div.find('.sonos-ctrl-seek-input').val(percent);
                $div.find('.sonos-ctrl-seek .sonos-ctrl-time').first().text(vis.binds.sonos.formatTime(elapsed));
                $div.find('.sonos-ctrl-seek .sonos-ctrl-time').last().text(
                    vis.binds.sonos.state(playerId, 'current_duration_s') || vis.binds.sonos.formatTime(snap.duration)
                );
            }
            if (!$div.find('.sonos-ctrl-volume-input:focus').length) {
                var volume = parseInt(vis.binds.sonos.state(selectedId, 'volume'), 10);
                if (!isNaN(volume)) {
                    $div.find('.sonos-ctrl-volume-input').val(volume);
                    $div.find('.sonos-ctrl-volume .sonos-ctrl-time').text(volume);
                }
            }
        },

        parseQueue: function (playerId) {
            var html = String(vis.binds.sonos.state(playerId, 'queue_html') || '');
            var items = [];
            if (html) {
                var $rows = $('<div></div>').html(html).find('.sonosQueueRow');
                $rows.each(function (index) {
                    var $row = $(this);
                    items.push({
                        no: index + 1,
                        title: $.trim($row.find('.sonosQueueTrackTitle').text()),
                        artist: $.trim($row.find('.sonosQueueTrackArtist').text()),
                        album: $.trim($row.find('.sonosQueueTrackAlbum').text()),
                        cover: $row.find('img').attr('src') || '',
                        current: $row.hasClass('currentTrack') || $row.attr('id') === 'currentTrack',
                    });
                });
                if (items.length) {
                    return items;
                }
            }
            vis.binds.sonos.parseList(vis.binds.sonos.state(playerId, 'queue')).forEach(function (entry, index) {
                var parts = String(entry).split(' - ');
                items.push({
                    no: index + 1,
                    artist: parts.length > 1 ? parts.shift() : '',
                    title: parts.join(' - ') || entry,
                    album: '',
                    cover: '',
                    current: false,
                });
            });
            return items;
        },

        parseFavorites: function (playerId) {
            var html = String(vis.binds.sonos.state(playerId, 'favorites_list_html') || '');
            var items = [];
            if (html) {
                $('<div></div>').html(html).find('.sonosFavoriteRow').each(function () {
                    var $row = $(this);
                    items.push({
                        title: $.trim($row.find('.sonosFavoriteTitle').text()),
                        cover: $row.find('img').attr('src') || '',
                    });
                });
                if (items.length) {
                    return items;
                }
            }
            return vis.binds.sonos.parseList(vis.binds.sonos.state(playerId, 'favorites_list_array') || vis.binds.sonos.state(playerId, 'favorites_list')).map(function (title) {
                return { title: title, cover: '' };
            });
        },

        parseRecent: function (playerId) {
            var raw = vis.binds.sonos.state(playerId, 'recent_tracks');
            var list = [];
            if (Array.isArray(raw)) {
                list = raw;
            } else if (typeof raw === 'string' && raw) {
                try {
                    var parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        list = parsed;
                    }
                } catch (e) {
                    list = [];
                }
            }
            return list.filter(function (item) {
                return item && item.title;
            }).map(function (item) {
                var cover = String(item.cover || '');
                if (cover && !vis.binds.sonos.isLiveCover(cover)) {
                    return item;
                }
                var restored = vis.binds.sonos.artFromMeta(item.metadata) ||
                    vis.binds.sonos.favoriteCover(playerId, item.station || item.title);
                if (!restored) {
                    return cover ? Object.assign({}, item, { cover: '' }) : item;
                }
                return Object.assign({}, item, { cover: restored });
            });
        },

        nowPlaying: function (playerId) {
            var title = String(vis.binds.sonos.state(playerId, 'current_title') || '').trim();
            var station = String(vis.binds.sonos.state(playerId, 'current_station') || '').trim();
            var artist = String(vis.binds.sonos.state(playerId, 'current_artist') || '').trim();
            var album = String(vis.binds.sonos.state(playerId, 'current_album') || '').trim();
            var type = parseInt(vis.binds.sonos.state(playerId, 'current_type'), 10);
            var uri = String(vis.binds.sonos.state(playerId, 'current_uri') || '').trim();
            var durationS = vis.binds.sonos.parseTime(vis.binds.sonos.state(playerId, 'current_duration_s'));
            var durationN = parseFloat(vis.binds.sonos.state(playerId, 'current_duration'));
            var tvLabel = vis.binds.sonos.t('tv');
            if (!title) {
                title = station;
            }
            if (!title && type === 2) {
                title = tvLabel;
            }
            if (!title) {
                title = vis.binds.sonos.t('nothing');
            }
            var isTv = type === 2 && (
                station === 'TV' ||
                station === tvLabel ||
                title === 'TV' ||
                title === tvLabel
            );
            var hasDuration = durationS > 0 || durationN > 0;
            var radioUri = /^(x-sonosapi-stream:|x-sonosapi-radio:|x-sonosapi-hls:|x-rincon-mp3radio:|pndrradio:|aac:)/i.test(uri);
            return {
                title: title,
                artist: artist,
                album: album,
                station: station,
                type: type,
                isTv: isTv,
                isRadio: !isTv && !hasDuration && (type === 1 || radioUri || Boolean(station)),
            };
        },

        emptyQuickstart: function () {
            return { title: '', artist: '', album: '', station: '', cover: '', uri: '', metadata: '', favorite: '', tv: false };
        },

        parseQuickstarts: function (instance) {
            var raw = vis.binds.sonos.val(instance + '.quickstarts');
            var list = [];
            if (Array.isArray(raw)) {
                list = raw;
            } else if (typeof raw === 'string' && raw.trim()) {
                try {
                    var parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        list = parsed;
                    }
                } catch (e) {
                    list = [];
                }
            }
            var slots = [];
            var i;
            for (i = 0; i < 8; i++) {
                var item = list[i] && typeof list[i] === 'object' ? list[i] : {};
                slots.push({
                    title: String(item.title || '').trim(),
                    artist: String(item.artist || '').trim(),
                    album: String(item.album || '').trim(),
                    station: String(item.station || '').trim(),
                    cover: String(item.cover || '').trim(),
                    uri: String(item.uri || '').trim(),
                    metadata: String(item.metadata || ''),
                    favorite: String(item.favorite || '').trim(),
                    tv: item.tv === true || item.tv === 'true',
                });
            }
            return slots;
        },

        writeQuickstarts: function (instance, slots) {
            vis.binds.sonos.write(instance + '.quickstarts', JSON.stringify(slots));
        },

        quickstartFilled: function (slot) {
            return !!(slot && (slot.tv || slot.uri || slot.favorite));
        },

        isLiveCover: function (cover) {
            return /(?:^|\/)coverImage\/(?!art\/)[^/?#]+\.png(?:\?|#|$)/i.test(String(cover || ''));
        },

        artFromMeta: function (xml) {
            var match = String(xml || '').match(/<(?:[\w.-]+:)?albumArtURI\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?albumArtURI>/i);
            if (!match) {
                return '';
            }
            return String(match[1] || '').trim();
        },

        favoriteCover: function (mediaId, title) {
            var want = String(title || '').trim().toLowerCase();
            if (!want) {
                return '';
            }
            var cover = '';
            vis.binds.sonos.parseFavorites(mediaId).forEach(function (item) {
                var name = String(item.title || '').trim().toLowerCase();
                if (name && item.cover && name === want) {
                    cover = item.cover;
                }
            });
            return cover;
        },

        quickstartCover: function (slot, mediaId) {
            var cover = slot && slot.cover ? String(slot.cover) : '';
            if (cover && vis.binds.sonos.isLiveCover(cover)) {
                cover = '';
            }
            if (!cover && slot) {
                cover = vis.binds.sonos.favoriteCover(mediaId, slot.favorite || slot.station || slot.title);
            }
            return cover;
        },

        tvArtSvg: function (size) {
            size = size || 36;
            return '<svg viewBox="0 0 80 80" width="' + size + '" height="' + size + '">' +
                '<rect x="12" y="16" width="56" height="38" rx="4" fill="#2a2a2a" stroke="#8a8a8a" stroke-width="2.4"/>' +
                '<rect x="17" y="21" width="46" height="28" rx="2" fill="#111"/>' +
                '<path d="M34 58 L40 52 L46 58" fill="none" stroke="#8a8a8a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
                '<line x1="28" y1="64" x2="52" y2="64" stroke="#8a8a8a" stroke-width="2.4" stroke-linecap="round"/>' +
                '<circle cx="19.5" cy="50.5" r="1.6" fill="#e31c23"/>' +
                '</svg>';
        },

        quickstartArtHtml: function (slot, mediaId) {
            if (slot.tv) {
                return '<span class="sonos-ctrl-quick-art is-tv" aria-hidden="true">' + vis.binds.sonos.tvArtSvg(36) + '</span>';
            }
            var cover = vis.binds.sonos.quickstartCover(slot, mediaId);
            if (cover) {
                return '<span class="sonos-ctrl-quick-art" style="background-image:url(\'' + vis.binds.sonos.esc(cover) + '\')"></span>';
            }
            return '<span class="sonos-ctrl-quick-art is-blank"></span>';
        },

        snapshotQuickstart: function (selected, mediaId) {
            var now = vis.binds.sonos.nowPlaying(mediaId);
            var nothing = vis.binds.sonos.t('nothing');
            var uri = String(vis.binds.sonos.state(mediaId, 'current_uri') || '').trim();
            if (!uri) {
                uri = String(vis.binds.sonos.state(selected.id, 'current_uri') || '').trim();
            }
            var metadata = String(vis.binds.sonos.state(mediaId, 'current_metadata') || vis.binds.sonos.state(selected.id, 'current_metadata') || '');
            var cover = String(vis.binds.sonos.state(mediaId, 'current_art') || vis.binds.sonos.state(selected.id, 'current_art') || '');
            if (!cover || vis.binds.sonos.isLiveCover(cover)) {
                cover = String(vis.binds.sonos.state(mediaId, 'current_cover') || vis.binds.sonos.state(selected.id, 'current_cover') || '');
            }
            if (vis.binds.sonos.isLiveCover(cover)) {
                cover = '';
            }
            var favorite = '';
            vis.binds.sonos.parseFavorites(mediaId).forEach(function (item) {
                if (item.title && (item.title === now.title || item.title === now.station)) {
                    favorite = item.title;
                    if (!cover && item.cover) {
                        cover = item.cover;
                    }
                }
            });
            if (now.isTv) {
                return {
                    title: vis.binds.sonos.t('tv'),
                    artist: now.artist,
                    album: '',
                    station: now.station,
                    cover: cover,
                    uri: '',
                    metadata: '',
                    favorite: '',
                    tv: true,
                };
            }
            if ((!uri && !favorite) || now.title === nothing) {
                return null;
            }
            return {
                title: now.station || now.title,
                artist: now.artist,
                album: now.album,
                station: now.station,
                cover: cover,
                uri: uri,
                metadata: metadata,
                favorite: favorite,
                tv: false,
            };
        },

        playQuickstart: function (slot, selected, mediaId) {
            if (!vis.binds.sonos.quickstartFilled(slot)) {
                return;
            }
            if (slot.tv) {
                vis.binds.sonos.write(selected.id + '.media_play', JSON.stringify({ tv: true }));
                return;
            }
            if (slot.favorite) {
                vis.binds.sonos.write(mediaId + '.favorites_set', slot.favorite);
                return;
            }
            vis.binds.sonos.write(mediaId + '.media_play', JSON.stringify({ uri: slot.uri, metadata: slot.metadata || '' }));
        },

        parseBrowse: function (playerId) {
            var raw = vis.binds.sonos.state(playerId, 'media_browse_result');
            if (!raw) {
                return { id: '', title: '', items: [] };
            }
            if (typeof raw === 'object' && !Array.isArray(raw)) {
                if (raw.val != null && raw.items == null) {
                    raw = raw.val;
                } else if (Array.isArray(raw.items) || raw.id) {
                    return {
                        id: raw.id || '',
                        title: raw.title || '',
                        items: Array.isArray(raw.items) ? raw.items : [],
                        serviceName: raw.serviceName,
                        loginUrl: raw.loginUrl,
                        loginHint: raw.loginHint,
                        searchable: raw.searchable,
                    };
                }
            }
            try {
                var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (parsed && typeof parsed === 'object') {
                    return {
                        id: parsed.id || '',
                        title: parsed.title || '',
                        items: Array.isArray(parsed.items) ? parsed.items : [],
                        serviceName: parsed.serviceName,
                        loginUrl: parsed.loginUrl,
                        loginHint: parsed.loginHint,
                        searchable: parsed.searchable,
                    };
                }
            } catch (e) {
                // ignore
            }
            return { id: '', title: '', items: [] };
        },

        defaultRootItems: function () {
            return [
                { id: 'tv', title: vis.binds.sonos.t('tv'), artist: vis.binds.sonos.t('tvHdmi') },
                { id: 'R:0', title: vis.binds.sonos.t('radio'), folder: true },
                { id: 'service:Spotify', title: 'Spotify', folder: true, service: true },
                { id: 'service:YouTube Music', title: 'YouTube Music', folder: true, service: true },
                { id: 'A:', title: vis.binds.sonos.t('library'), folder: true },
                { id: 'S:', title: vis.binds.sonos.t('shares'), folder: true },
                { id: 'AI:', title: vis.binds.sonos.t('lineIn'), folder: true },
            ];
        },

        filterQuery: function (items, query, textFn) {
            var q = String(query || '').trim().toLowerCase();
            if (!q) {
                return items;
            }
            return items.filter(function (item) {
                return String(textFn(item) || '').toLowerCase().indexOf(q) !== -1;
            });
        },

        applySheetFilter: function ($div) {
            var q = String($div.data('sonos-sheet-query') || '').trim().toLowerCase();
            var visible = 0;
            $div.find('.sonos-ctrl-sheet .sonos-ctrl-item').each(function () {
                var ok = !q || ($(this).text() || '').toLowerCase().indexOf(q) !== -1;
                $(this).toggle(ok);
                if (ok) {
                    visible += 1;
                }
            });
            var $empty = $div.find('.sonos-ctrl-sheet-filter-empty');
            if ($empty.length) {
                $empty.toggle(Boolean(q && !visible));
            }
        },

        closeLibrary: function ($div, instance) {
            $div.data('sonos-sheet', false);
            $div.data('sonos-sheet-query', '');
            vis.binds.sonos.render($div.attr('id'), instance);
        },

        browseItemButton: function (item) {
            var payload = encodeURIComponent(JSON.stringify({
                id: item.id || '',
                uri: item.uri || '',
                metadata: item.metadata || '',
                folder: !!item.folder,
                service: !!item.service,
                favorite: item.favorite || '',
                playlist: item.playlist || '',
                title: item.title || '',
            }));
            return '<button type="button" class="sonos-ctrl-item" data-media-item="' + vis.binds.sonos.esc(payload) + '">' +
                (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div>' +
                '<div class="sonos-ctrl-item-sub">' + vis.binds.sonos.esc(item.artist || item.album || (item.folder ? '…' : '') || (item.service ? 'Service' : '')) + '</div></div></button>';
        },

        serviceNameFromBrowse: function ($div, browse) {
            if (browse && browse.serviceName) {
                return String(browse.serviceName);
            }
            var ids = (($div.data('sonos-browse-path') || []).map(function (item) { return item.id; })).concat([browse && browse.id]);
            var i;
            for (i = 0; i < ids.length; i++) {
                var id = String(ids[i] || '');
                if (id.indexOf('service:') === 0) {
                    return id.slice('service:'.length);
                }
                if (id.indexOf('smapi:') === 0) {
                    var rest = id.slice('smapi:'.length);
                    var colon = rest.indexOf(':');
                    try {
                        return decodeURIComponent(colon === -1 ? rest : rest.slice(0, colon));
                    } catch (e) {
                        return colon === -1 ? rest : rest.slice(0, colon);
                    }
                }
            }
            return '';
        },

        isGroupedWith: function (player, other) {
            var coordA = String(vis.binds.sonos.state(player.id, 'coordinator') || player.ip);
            var coordB = String(vis.binds.sonos.state(other.id, 'coordinator') || other.ip);
            return coordA && coordA === coordB;
        },

        groupNameColor: function (player, players) {
            var count = 0;
            players.forEach(function (other) {
                if (vis.binds.sonos.isGroupedWith(player, other)) {
                    count += 1;
                }
            });
            if (count < 2) {
                return '';
            }
            var palette = ['#7dd3fc', '#86efac', '#f9a8d4', '#c4b5fd', '#67e8f9', '#fb7185', '#a3e635', '#818cf8'];
            var key = String(vis.binds.sonos.state(player.id, 'coordinator') || player.ip);
            var hash = 0;
            for (var i = 0; i < key.length; i++) {
                hash = ((hash << 5) - hash) + key.charCodeAt(i);
                hash |= 0;
            }
            var color = palette[Math.abs(hash) % palette.length];
            var isMaster = key === player.ip;
            return isMaster ? color : vis.binds.sonos.shadeColor(color, 0.58);
        },

        shadeColor: function (hex, factor) {
            hex = String(hex || '').replace('#', '');
            if (hex.length !== 6) {
                return '#' + hex;
            }
            var out = '#';
            for (var i = 0; i < 6; i += 2) {
                var n = Math.round(parseInt(hex.substring(i, i + 2), 16) * factor);
                if (n < 0) {
                    n = 0;
                }
                if (n > 255) {
                    n = 255;
                }
                var part = n.toString(16);
                out += part.length < 2 ? '0' + part : part;
            }
            return out;
        },

        render: function (widgetID, instance) {
            var $div = $('#' + widgetID);
            if (!$div.length) {
                return;
            }

            var t = vis.binds.sonos.t;
            var players = vis.binds.sonos.findPlayers(instance);
            if (!players.length) {
                $div.html('<div class="' + vis.binds.sonos.themeClass($div) + '"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(t('noPlayers')) + '</div></div>');
                return;
            }

            var selectedIp = $div.data('sonos-player') || vis.binds.sonos.loadRoom(widgetID, instance);
            var selected = players.filter(function (player) { return player.ip === selectedIp; })[0] || players[0];
            $div.data('sonos-player', selected.ip);
            vis.binds.sonos.saveRoom(widgetID, instance, selected.ip);
            var tab = $div.data('sonos-tab') || 'favorites';
            var sheetOpen = !!$div.data('sonos-sheet');
            var query = String($div.data('sonos-sheet-query') || '');
            var searchHadFocus = $div.find('.sonos-ctrl-search-input').is(':focus');
            var mediaId = vis.binds.sonos.mediaPlayerId(selected);
            var playing = vis.binds.sonos.state(mediaId, 'state') === 'play';
            var now = vis.binds.sonos.nowPlaying(mediaId);
            var title = now.title;
            var artist = now.artist;
            var album = now.album;
            var station = now.station;
            var cover = vis.binds.sonos.state(mediaId, 'current_cover');
            var volume = parseInt(vis.binds.sonos.state(selected.id, 'volume'), 10);
            if (isNaN(volume)) {
                volume = 0;
            }
            var seek = parseFloat(vis.binds.sonos.state(mediaId, 'seek'));
            if (isNaN(seek)) {
                seek = 0;
            }
            var muted = !!vis.binds.sonos.state(selected.id, 'muted');
            var nightMode = !!vis.binds.sonos.state(selected.id, 'night_mode');
            var speechOn = !!vis.binds.sonos.state(selected.id, 'speech_enhancement');
            var shuffle = !!vis.binds.sonos.state(mediaId, 'shuffle');
            var repeat = parseInt(vis.binds.sonos.state(mediaId, 'repeat'), 10) || 0;
            var elapsed = vis.binds.sonos.state(mediaId, 'current_elapsed_s') || '00:00';
            var duration = vis.binds.sonos.state(mediaId, 'current_duration_s') || '00:00';
            var durationSec = vis.binds.sonos.parseTime(duration);
            var coordinator = String(vis.binds.sonos.state(selected.id, 'coordinator') || selected.ip);
            var groupVolume = parseInt(vis.binds.sonos.state(mediaId, 'group_volume'), 10);
            var grouped = players.filter(function (player) {
                return vis.binds.sonos.isGroupedWith(selected, player);
            });

            var roomsHtml = players.map(function (player) {
                var isActive = player.ip === selected.ip;
                var isPlaying = vis.binds.sonos.state(vis.binds.sonos.mediaPlayerId(player), 'state') === 'play';
                var alive = vis.binds.sonos.state(player.id, 'alive') !== false;
                var nameColor = vis.binds.sonos.groupNameColor(player, players);
                var coord = String(vis.binds.sonos.state(player.id, 'coordinator') || player.ip);
                var isMaster = Boolean(nameColor && coord === player.ip);
                return '<button type="button" class="sonos-ctrl-chip' +
                    (isActive ? ' is-active' : '') +
                    (isPlaying ? ' is-playing' : '') +
                    (isMaster ? ' is-master' : '') +
                    (alive ? '' : ' is-offline') +
                    '" data-ip="' + vis.binds.sonos.esc(player.ip) + '"' +
                    (nameColor ? ' style="--sonos-name:' + nameColor + '"' : '') + '>' +
                    vis.binds.sonos.esc(player.name) +
                    '</button>';
            }).join('');

            var groupHtml = players.filter(function (player) { return player.ip !== selected.ip; }).map(function (player) {
                var checked = vis.binds.sonos.isGroupedWith(selected, player) ? ' checked' : '';
                var nameColor = vis.binds.sonos.groupNameColor(player, players);
                return '<label' + (nameColor ? ' style="--sonos-name:' + nameColor + '"' : '') + '><input type="checkbox" data-group-ip="' + vis.binds.sonos.esc(player.ip) + '"' + checked + '> ' +
                    vis.binds.sonos.esc(player.name) + '</label>';
            }).join('');

            if (groupHtml) {
                groupHtml = '<span>' + vis.binds.sonos.esc(t('group')) + '</span>' + groupHtml +
                    '<button type="button" class="sonos-ctrl-ungroup">' + vis.binds.sonos.esc(t('dissolve')) + '</button>';
                if (grouped.length > 1 && !isNaN(groupVolume)) {
                    groupHtml += '<span>Grp</span><input type="range" min="0" max="100" class="sonos-ctrl-group-volume" value="' + groupVolume + '">';
                }
            }

            var listHtml = '';
            var serviceName = '';
            if (sheetOpen && tab === 'favorites') {
                var favorites = vis.binds.sonos.filterQuery(vis.binds.sonos.parseFavorites(mediaId), query, function (item) {
                    return item.title;
                });
                listHtml = favorites.length
                    ? favorites.map(function (item) {
                        return '<button type="button" class="sonos-ctrl-item" data-favorite="' + vis.binds.sonos.esc(item.title) + '">' +
                            (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                            '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t(query ? 'noSearchHits' : 'emptyFavorites')) + '</div>';
            } else if (sheetOpen && tab === 'playlists') {
                var playlists = vis.binds.sonos.filterQuery(vis.binds.sonos.parseList(
                    vis.binds.sonos.state(mediaId, 'playlist_list_array') || vis.binds.sonos.state(mediaId, 'playlist_list')
                ), query, function (name) { return name; });
                listHtml = playlists.length
                    ? playlists.map(function (name) {
                        return '<button type="button" class="sonos-ctrl-item" data-playlist="' + vis.binds.sonos.esc(name) + '">' +
                            '<div class="sonos-ctrl-thumb"></div><div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(name) + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t(query ? 'noSearchHits' : 'emptyPlaylists')) + '</div>';
            } else if (sheetOpen && tab === 'recent') {
                var recent = vis.binds.sonos.filterQuery(vis.binds.sonos.parseRecent(selected.id), query, function (item) {
                    return [item.title, item.artist, item.album, item.station].join(' ');
                });
                listHtml = recent.length
                    ? recent.map(function (item) {
                        return '<button type="button" class="sonos-ctrl-item" data-recent-uri="' + vis.binds.sonos.esc(item.uri || '') +
                            '" data-recent-meta="' + vis.binds.sonos.esc(encodeURIComponent(item.metadata || '')) +
                            '" data-recent-station="' + vis.binds.sonos.esc(item.station || '') +
                            '" data-recent-title="' + vis.binds.sonos.esc(item.title) + '">' +
                            (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                            '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div>' +
                            '<div class="sonos-ctrl-item-sub">' + vis.binds.sonos.esc(item.artist || item.album || item.station || '') + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t(query ? 'noSearchHits' : 'emptyRecent')) + '</div>';
            } else if (sheetOpen && tab === 'sources') {
                var browse = vis.binds.sonos.parseBrowse(mediaId);
                var path = $div.data('sonos-browse-path') || [];
                var atRoot = !path.length;
                var items = browse.items || [];
                if (atRoot && browse.id !== 'root') {
                    var requestKey = mediaId + ':root';
                    if ($div.data('sonos-browse-req') !== requestKey) {
                        $div.data('sonos-browse-req', requestKey);
                        vis.binds.sonos.write(mediaId + '.media_browse', 'root');
                    }
                } else if (browse.id === 'root') {
                    $div.data('sonos-browse-req', '');
                }
                if (atRoot && (browse.id !== 'root' || !items.length)) {
                    items = vis.binds.sonos.defaultRootItems();
                }
                serviceName = (!atRoot || browse.id === 'root')
                    ? vis.binds.sonos.serviceNameFromBrowse($div, browse)
                    : '';
                items = vis.binds.sonos.filterQuery(items, query, function (item) {
                    return [item.title, item.artist, item.album].join(' ');
                });
                var backHtml = path.length
                    ? '<button type="button" class="sonos-ctrl-item" data-browse-back="1">' +
                        '<div class="sonos-ctrl-thumb"></div>' +
                        '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(t('back')) + '</div></div></button>'
                    : '';
                var extraHtml = '';
                if (serviceName && (browse.loginUrl || browse.loginHint)) {
                    extraHtml += '<div class="sonos-ctrl-login">' +
                        '<div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(browse.loginHint || t('loginOpen')) + '</div>' +
                        (browse.loginUrl ? '<div class="sonos-ctrl-login-url">' + vis.binds.sonos.esc(browse.loginUrl) + '</div>' : '') +
                        (browse.loginUrl
                            ? '<button type="button" class="sonos-ctrl-login-btn" data-smapi-auth="' + vis.binds.sonos.esc(serviceName) + '">' + vis.binds.sonos.esc(t('signedIn')) + '</button>'
                            : '') +
                        '</div>';
                }
                listHtml = extraHtml + backHtml + (items.length
                    ? items.map(vis.binds.sonos.browseItemButton).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(path.length || query ? t('noSearchHits') : t('emptySources')) + '</div>');
            } else if (sheetOpen) {
                var queue = vis.binds.sonos.filterQuery(vis.binds.sonos.parseQueue(mediaId), query, function (item) {
                    return [item.title, item.artist, item.album].join(' ');
                });
                var currentNo = parseInt(vis.binds.sonos.state(mediaId, 'current_track_number'), 10) || 0;
                listHtml = queue.length
                    ? queue.map(function (item) {
                        var current = item.current || item.no === currentNo;
                        return '<button type="button" class="sonos-ctrl-item' + (current ? ' is-current' : '') + '" data-track="' + item.no + '">' +
                            (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                            '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div>' +
                            '<div class="sonos-ctrl-item-sub">' + vis.binds.sonos.esc(item.artist || item.album || '') + '</div></div>' +
                            '<div>' + item.no + '</div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t(query ? 'noSearchHits' : 'emptyQueue')) + '</div>';
            }

            var sub = [artist, album].filter(Boolean).join(' — ');
            if (!album && station && station !== title) {
                sub = [sub, station].filter(Boolean).join(' — ');
            }
            var coverHtml = now.isTv
                ? '<div class="sonos-ctrl-cover is-tv" aria-hidden="true">' +
                    '<svg viewBox="0 0 80 80" width="92" height="92">' +
                    '<rect x="12" y="16" width="56" height="38" rx="4" fill="#2a2a2a" stroke="#8a8a8a" stroke-width="2.4"/>' +
                    '<rect x="17" y="21" width="46" height="28" rx="2" fill="#111"/>' +
                    '<path d="M34 58 L40 52 L46 58" fill="none" stroke="#8a8a8a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<line x1="28" y1="64" x2="52" y2="64" stroke="#8a8a8a" stroke-width="2.4" stroke-linecap="round"/>' +
                    '<circle cx="19.5" cy="50.5" r="1.6" fill="#e31c23"/>' +
                    '</svg></div>'
                : '<div class="sonos-ctrl-cover"' + (cover ? ' style="background-image:url(\'' + vis.binds.sonos.esc(cover) + '\')"' : '') + '>' +
                    (cover ? '' : 'SONOS') + '</div>';
            var buttonsHtml = now.isTv
                ? '<button type="button" class="sonos-ctrl-btn' + (muted ? ' is-on' : '') + '" data-cmd="mute" title="Mute">' + (muted ? '&#128263;' : '&#128266;') + '</button>'
                : '<button type="button" class="sonos-ctrl-btn" data-cmd="prev" title="Prev">&#9198;</button>' +
                    '<button type="button" class="sonos-ctrl-btn sonos-ctrl-btn-play" data-cmd="' + (playing ? 'pause' : 'play') + '" title="Play/Pause">' + (playing ? '&#10073;&#10073;' : '&#9654;') + '</button>' +
                    '<button type="button" class="sonos-ctrl-btn" data-cmd="next" title="Next">&#9197;</button>' +
                    '<button type="button" class="sonos-ctrl-btn' + (muted ? ' is-on' : '') + '" data-cmd="mute" title="Mute">' + (muted ? '&#128263;' : '&#128266;') + '</button>' +
                    '<button type="button" class="sonos-ctrl-btn' + (shuffle ? ' is-on' : '') + '" data-cmd="shuffle" title="Shuffle">&#128256;</button>' +
                    '<button type="button" class="sonos-ctrl-btn' + (repeat ? ' is-on' : '') + '" data-cmd="repeat" title="Repeat">' + (repeat === 2 ? '1' : '&#128257;') + '</button>';
            var htHtml = now.isTv
                ? '<div class="sonos-ctrl-ht">' +
                    '<button type="button" class="sonos-ctrl-ht-btn' + (nightMode ? ' is-on' : '') + '" data-ht="night_mode">' + vis.binds.sonos.esc(t('nightSound')) + '</button>' +
                    '<button type="button" class="sonos-ctrl-ht-btn' + (speechOn ? ' is-on' : '') + '" data-ht="speech_enhancement">' + vis.binds.sonos.esc(t('speechEnhance')) + '</button>' +
                '</div>'
                : '';
            var seekHtml = now.isTv || now.isRadio
                ? ''
                : '<div class="sonos-ctrl-seek">' +
                    '<span class="sonos-ctrl-time">' + vis.binds.sonos.esc(elapsed) + '</span>' +
                    '<input type="range" min="0" max="100" step="1" class="sonos-ctrl-seek-input" value="' + seek + '">' +
                    '<span class="sonos-ctrl-time">' + vis.binds.sonos.esc(duration) + '</span>' +
                '</div>';

            var tabsHtml =
                '<button type="button" class="sonos-ctrl-tab' + (sheetOpen && tab === 'favorites' ? ' is-active' : '') + '" data-tab="favorites">' + vis.binds.sonos.esc(t('favorites')) + '</button>' +
                '<button type="button" class="sonos-ctrl-tab' + (sheetOpen && tab === 'playlists' ? ' is-active' : '') + '" data-tab="playlists">' + vis.binds.sonos.esc(t('playlists')) + '</button>' +
                '<button type="button" class="sonos-ctrl-tab' + (sheetOpen && tab === 'queue' ? ' is-active' : '') + '" data-tab="queue">' + vis.binds.sonos.esc(t('queue')) + '</button>' +
                '<button type="button" class="sonos-ctrl-tab' + (sheetOpen && tab === 'recent' ? ' is-active' : '') + '" data-tab="recent">' + vis.binds.sonos.esc(t('recent')) + '</button>' +
                '<button type="button" class="sonos-ctrl-tab' + (sheetOpen && tab === 'sources' ? ' is-active' : '') + '" data-tab="sources">' + vis.binds.sonos.esc(t('sources')) + '</button>';
            var searchHtml = '<form class="sonos-ctrl-search"' +
                (serviceName ? ' data-smapi-search="' + vis.binds.sonos.esc(serviceName) + '"' : '') + '>' +
                '<input type="search" class="sonos-ctrl-search-input" value="' + vis.binds.sonos.esc(query) + '" placeholder="' + vis.binds.sonos.esc(t('search')) + '" enterkeyhint="search">' +
                (serviceName ? '<button type="submit" class="sonos-ctrl-search-btn">' + vis.binds.sonos.esc(t('searchGo')) + '</button>' : '') +
                '</form>';
            var sheetHtml = sheetOpen
                ? '<button type="button" class="sonos-ctrl-sheet-dismiss" aria-label="Close"></button>' +
                    '<div class="sonos-ctrl-sheet">' +
                        searchHtml +
                        '<div class="sonos-ctrl-list">' +
                            listHtml +
                            '<div class="sonos-ctrl-empty sonos-ctrl-sheet-filter-empty" style="display:none">' + vis.binds.sonos.esc(t('noSearchHits')) + '</div>' +
                        '</div>' +
                    '</div>'
                : '';
            var slots = vis.binds.sonos.parseQuickstarts(instance);
            var editIndex = parseInt($div.data('sonos-quick-edit'), 10);
            var quickHtml = '<div class="sonos-ctrl-quick">' + slots.map(function (slot, index) {
                var filled = vis.binds.sonos.quickstartFilled(slot);
                var label = filled ? (slot.title || slot.station || slot.favorite || t('tv')) : (index + 1) + ' · +';
                var sub = filled ? (slot.artist || slot.station || slot.favorite || '') : t('quickEmpty');
                return '<button type="button" class="sonos-ctrl-quick-btn' +
                    (filled ? '' : ' is-empty') +
                    (editIndex === index ? ' is-edit' : '') +
                    '" data-quick="' + index + '" title="' + vis.binds.sonos.esc(filled ? t('quickPlay') + ' / ' + t('quickEdit') : t('quickSave')) + '">' +
                    (filled ? vis.binds.sonos.quickstartArtHtml(slot, mediaId) : '') +
                    '<span class="sonos-ctrl-quick-text">' +
                    '<span class="sonos-ctrl-quick-no">' + (index + 1) + '</span>' +
                    '<span class="sonos-ctrl-quick-title">' + vis.binds.sonos.esc(label) + '</span>' +
                    '<span class="sonos-ctrl-quick-sub">' + vis.binds.sonos.esc(sub) + '</span>' +
                    '</span></button>';
            }).join('') + '</div>';
            var editSlot = editIndex >= 0 && editIndex < 8 ? slots[editIndex] : null;
            var menuHtml = editSlot
                ? '<div class="sonos-ctrl-quick-menu" data-quick-menu="' + editIndex + '">' +
                    '<div class="sonos-ctrl-quick-menu-title">' + vis.binds.sonos.esc(t('quickEdit')) + ' ' + (editIndex + 1) + '</div>' +
                    '<input type="text" class="sonos-ctrl-quick-name" value="' + vis.binds.sonos.esc(editSlot.title || '') + '" placeholder="' + vis.binds.sonos.esc(t('quickRename')) + '">' +
                    '<div class="sonos-ctrl-quick-menu-actions">' +
                        '<button type="button" class="is-primary" data-quick-act="replace">' + vis.binds.sonos.esc(t('quickReplace')) + '</button>' +
                        '<button type="button" data-quick-act="rename">' + vis.binds.sonos.esc(t('quickRename')) + '</button>' +
                        (vis.binds.sonos.quickstartFilled(editSlot) ? '<button type="button" data-quick-act="clear">' + vis.binds.sonos.esc(t('quickClear')) + '</button>' : '') +
                    '</div>' +
                    '</div>'
                : '';

            $div.html(
                '<div class="' + vis.binds.sonos.themeClass($div) + '">' +
                    '<div class="sonos-ctrl-header">' +
                        '<div class="sonos-ctrl-brand">SONOS</div>' +
                        '<span class="sonos-ctrl-ver">' + vis.binds.sonos.esc(vis.binds.sonos.version) + '</span>' +
                        '<div class="sonos-ctrl-rooms">' + roomsHtml + '</div>' +
                    '</div>' +
                    '<div class="sonos-ctrl-tabs">' + tabsHtml + '</div>' +
                    '<div class="sonos-ctrl-body">' +
                        '<div class="sonos-ctrl-main">' +
                            coverHtml +
                            '<div class="sonos-ctrl-meta">' +
                                '<div class="sonos-ctrl-title">' + vis.binds.sonos.esc(title) + '</div>' +
                                '<div class="sonos-ctrl-sub">' + vis.binds.sonos.esc(sub) + '</div>' +
                                '<div class="sonos-ctrl-buttons">' + buttonsHtml + '</div>' +
                                seekHtml +
                                '<div class="sonos-ctrl-volume">' +
                                    '<span>Vol</span>' +
                                    '<input type="range" min="0" max="100" step="1" class="sonos-ctrl-volume-input" value="' + volume + '">' +
                                    '<span class="sonos-ctrl-time">' + volume + '</span>' +
                                '</div>' +
                                htHtml +
                                '<div class="sonos-ctrl-groups">' + groupHtml + '</div>' +
                            '</div>' +
                        '</div>' +
                        sheetHtml +
                    '</div>' +
                    quickHtml +
                    menuHtml +
                '</div>'
            );

            vis.binds.sonos.bindUi($div, selected, players, coordinator, mediaId);
            vis.binds.sonos.startTicker(widgetID, instance);
            if (sheetOpen && searchHadFocus) {
                $div.find('.sonos-ctrl-search-input').trigger('focus');
            }
        },

        bindUi: function ($div, selected, players, coordinator, mediaId) {
            mediaId = mediaId || selected.id;
            var instance = vis.binds.sonos.resolveInstance(selected.id);
            var widgetID = $div.attr('id');
            $div.find('.sonos-ctrl-chip').on('click', function () {
                var ip = String($(this).data('ip') || '');
                $div.data('sonos-player', ip);
                $div.data('sonos-browse-path', []);
                $div.data('sonos-sheet', false);
                $div.data('sonos-sheet-query', '');
                vis.binds.sonos.saveRoom(widgetID, instance, ip);
                vis.binds.sonos.render(widgetID, instance);
            });

            $div.find('[data-cmd]').on('click', function () {
                var cmd = $(this).data('cmd');
                if (cmd === 'play' || cmd === 'pause' || cmd === 'next' || cmd === 'prev') {
                    vis.binds.sonos.write(mediaId + '.' + cmd, true);
                } else if (cmd === 'mute') {
                    vis.binds.sonos.write(selected.id + '.muted', !vis.binds.sonos.state(selected.id, 'muted'));
                } else if (cmd === 'shuffle') {
                    vis.binds.sonos.write(mediaId + '.shuffle', !vis.binds.sonos.state(mediaId, 'shuffle'));
                } else if (cmd === 'repeat') {
                    var next = (parseInt(vis.binds.sonos.state(mediaId, 'repeat'), 10) || 0) + 1;
                    vis.binds.sonos.write(mediaId + '.repeat', next > 2 ? 0 : next);
                }
            });
            $div.find('[data-ht]').on('click', function () {
                var ht = String($(this).attr('data-ht') || '');
                if (ht !== 'night_mode' && ht !== 'speech_enhancement') {
                    return;
                }
                vis.binds.sonos.write(selected.id + '.' + ht, !vis.binds.sonos.state(selected.id, ht));
            });

            $div.find('.sonos-ctrl-volume-input').on('change input', function () {
                vis.binds.sonos.write(selected.id + '.volume', parseInt(this.value, 10));
            });
            $div.find('.sonos-ctrl-seek-input').on('change', function () {
                vis.binds.sonos.write(mediaId + '.seek', parseFloat(this.value));
            });
            $div.find('.sonos-ctrl-group-volume').on('change input', function () {
                vis.binds.sonos.write(mediaId + '.group_volume', parseInt(this.value, 10));
            });

            $div.find('[data-group-ip]').on('change', function () {
                var otherIp = String($(this).data('group-ip'));
                if (this.checked) {
                    vis.binds.sonos.write(mediaId + '.add_to_group', otherIp);
                } else {
                    vis.binds.sonos.write(mediaId + '.remove_from_group', otherIp);
                }
            });

            $div.find('.sonos-ctrl-ungroup').on('click', function () {
                players.forEach(function (player) {
                    if (player.ip !== selected.ip && vis.binds.sonos.isGroupedWith(selected, player)) {
                        vis.binds.sonos.write(selected.id + '.remove_from_group', player.ip);
                    }
                });
                if (String(coordinator) !== selected.ip) {
                    vis.binds.sonos.write(selected.id + '.coordinator', selected.ip);
                }
            });

            $div.find('[data-tab]').on('click', function (ev) {
                ev.stopPropagation();
                var next = String($(this).data('tab') || '');
                if ($div.data('sonos-sheet') && $div.data('sonos-tab') === next) {
                    vis.binds.sonos.closeLibrary($div, instance);
                    return;
                }
                $div.data('sonos-tab', next);
                $div.data('sonos-sheet', true);
                $div.data('sonos-sheet-query', '');
                if (next !== 'sources') {
                    $div.data('sonos-browse-path', []);
                }
                vis.binds.sonos.render(widgetID, instance);
            });
            $div.find('.sonos-ctrl-sheet-dismiss').on('click', function () {
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $(document).off('mousedown.sonosSheet' + widgetID).on('mousedown.sonosSheet' + widgetID, function (ev) {
                if (!$div.data('sonos-sheet')) {
                    return;
                }
                var $t = $(ev.target);
                if (
                    $t.closest('.sonos-ctrl-sheet').length ||
                    $t.closest('[data-tab]').length ||
                    $t.closest('.sonos-ctrl-chip').length ||
                    $t.closest('.sonos-ctrl-quick').length ||
                    $t.closest('.sonos-ctrl-quick-menu').length
                ) {
                    return;
                }
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $div.find('.sonos-ctrl-search-input').on('input', function () {
                $div.data('sonos-sheet-query', this.value);
                vis.binds.sonos.applySheetFilter($div);
            });

            $div.find('[data-favorite]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.favorites_set', String($(this).attr('data-favorite')));
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $div.find('[data-playlist]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.playlist_set', String($(this).attr('data-playlist')));
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $div.find('[data-track]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.current_track_number', parseInt($(this).data('track'), 10));
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $div.find('[data-recent-title]').on('click', function () {
                var uri = String($(this).attr('data-recent-uri') || '');
                var recentTitle = String($(this).attr('data-recent-title') || '');
                var station = String($(this).attr('data-recent-station') || '');
                var metadata = '';
                try {
                    metadata = decodeURIComponent(String($(this).attr('data-recent-meta') || ''));
                } catch (e) {
                    metadata = '';
                }
                var sonosUri = /^(x-sonos|x-rincon-mp3radio|x-rincon-stream|x-rincon-cpcontainer|aac:|pndrradio:|https?:)/i.test(uri) &&
                    !/^x-rincon:RINCON_/i.test(uri);
                if (sonosUri || metadata) {
                    vis.binds.sonos.write(mediaId + '.media_play', JSON.stringify({ uri: uri, metadata: metadata }));
                } else if (station || recentTitle) {
                    vis.binds.sonos.write(mediaId + '.favorites_set', station || recentTitle);
                }
                vis.binds.sonos.closeLibrary($div, instance);
            });
            $div.find('[data-browse-back]').on('click', function () {
                var path = ($div.data('sonos-browse-path') || []).slice();
                path.pop();
                $div.data('sonos-browse-path', path);
                $div.data('sonos-sheet-query', '');
                vis.binds.sonos.write(mediaId + '.media_browse', path.length ? path[path.length - 1].id : 'root');
            });
            $div.find('[data-smapi-auth]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.media_browse', 'smapi-auth:' + encodeURIComponent(String($(this).attr('data-smapi-auth') || '')));
            });
            $div.find('.sonos-ctrl-search').on('submit', function (ev) {
                ev.preventDefault();
                var name = String($(this).attr('data-smapi-search') || '');
                var term = String($(this).find('.sonos-ctrl-search-input').val() || '').trim();
                $div.data('sonos-sheet-query', term);
                if (!name || !term) {
                    vis.binds.sonos.applySheetFilter($div);
                    return;
                }
                var path = ($div.data('sonos-browse-path') || []).slice();
                var searchId = 'smapi-search:' + encodeURIComponent(name) + ':' + encodeURIComponent(term);
                path.push({ id: searchId, title: term });
                $div.data('sonos-browse-path', path);
                vis.binds.sonos.write(mediaId + '.media_browse', searchId);
            });
            $div.find('.sonos-ctrl-search-input').on('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.which === 13) {
                    ev.preventDefault();
                    $(this).closest('form').trigger('submit');
                }
            });
            $div.find('[data-media-item]').on('click', function () {
                var item = {};
                try {
                    item = JSON.parse(decodeURIComponent(String($(this).attr('data-media-item') || '')));
                } catch (e) {
                    return;
                }
                if (item.favorite) {
                    vis.binds.sonos.write(mediaId + '.media_play', JSON.stringify({ favorite: item.favorite }));
                    vis.binds.sonos.closeLibrary($div, instance);
                    return;
                }
                if (item.playlist) {
                    vis.binds.sonos.write(mediaId + '.media_play', JSON.stringify({ playlist: item.playlist }));
                    vis.binds.sonos.closeLibrary($div, instance);
                    return;
                }
                if (item.folder || item.service) {
                    var path = ($div.data('sonos-browse-path') || []).slice();
                    path.push({ id: item.id, title: item.title });
                    $div.data('sonos-browse-path', path);
                    $div.data('sonos-sheet-query', '');
                    vis.binds.sonos.write(mediaId + '.media_browse', item.id);
                    return;
                }
                if (item.id === 'tv' || /^x-sonos-htastream:/i.test(item.uri || '')) {
                    vis.binds.sonos.write(selected.id + '.media_play', JSON.stringify({ tv: true }));
                    vis.binds.sonos.closeLibrary($div, instance);
                    return;
                }
                if (item.uri) {
                    vis.binds.sonos.write(mediaId + '.media_play', JSON.stringify({ uri: item.uri, metadata: item.metadata || '' }));
                    vis.binds.sonos.closeLibrary($div, instance);
                }
            });

            var longTimer = null;
            var longFired = false;
            var saveCurrentTo = function (index) {
                var snap = vis.binds.sonos.snapshotQuickstart(selected, mediaId);
                if (!snap) {
                    return false;
                }
                var next = vis.binds.sonos.parseQuickstarts(instance);
                next[index] = snap;
                vis.binds.sonos.writeQuickstarts(instance, next);
                return true;
            };
            $div.find('[data-quick]').on('mousedown touchstart', function (ev) {
                if (ev.type === 'mousedown' && ev.which !== 1) {
                    return;
                }
                var index = parseInt($(this).attr('data-quick'), 10);
                longFired = false;
                clearTimeout(longTimer);
                longTimer = setTimeout(function () {
                    longFired = true;
                    $div.data('sonos-quick-edit', index);
                    vis.binds.sonos.render(widgetID, instance);
                }, 550);
            });
            $div.find('[data-quick]').on('mouseup mouseleave touchend touchcancel', function () {
                clearTimeout(longTimer);
            });
            $div.find('[data-quick]').on('contextmenu', function (ev) {
                ev.preventDefault();
                clearTimeout(longTimer);
                $div.data('sonos-quick-edit', parseInt($(this).attr('data-quick'), 10));
                vis.binds.sonos.render(widgetID, instance);
            });
            $div.find('[data-quick]').on('click', function (ev) {
                ev.preventDefault();
                if (longFired) {
                    return;
                }
                var index = parseInt($(this).attr('data-quick'), 10);
                var slot = vis.binds.sonos.parseQuickstarts(instance)[index];
                if (vis.binds.sonos.quickstartFilled(slot)) {
                    vis.binds.sonos.playQuickstart(slot, selected, mediaId);
                    return;
                }
                saveCurrentTo(index);
            });
            $div.find('[data-quick-act]').on('click', function () {
                var act = String($(this).attr('data-quick-act') || '');
                var index = parseInt($div.find('[data-quick-menu]').attr('data-quick-menu'), 10);
                var next = vis.binds.sonos.parseQuickstarts(instance);
                if (act === 'replace') {
                    if (!saveCurrentTo(index)) {
                        return;
                    }
                } else if (act === 'rename') {
                    next[index].title = String($div.find('.sonos-ctrl-quick-name').val() || '').trim() || next[index].title;
                    vis.binds.sonos.writeQuickstarts(instance, next);
                } else if (act === 'clear') {
                    next[index] = vis.binds.sonos.emptyQuickstart();
                    vis.binds.sonos.writeQuickstarts(instance, next);
                }
                $div.data('sonos-quick-edit', '');
                vis.binds.sonos.render(widgetID, instance);
            });
            $div.find('.sonos-ctrl-quick-name').on('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.which === 13) {
                    ev.preventDefault();
                    $div.find('[data-quick-act="rename"]').trigger('click');
                }
            });
            $(document).off('mousedown.sonosQuick' + widgetID).on('mousedown.sonosQuick' + widgetID, function (ev) {
                if ($div.data('sonos-quick-edit') === '' || $div.data('sonos-quick-edit') == null) {
                    return;
                }
                var $t = $(ev.target);
                if ($t.closest('.sonos-ctrl-quick-menu').length || $t.closest('[data-quick]').length) {
                    return;
                }
                $div.data('sonos-quick-edit', '');
                vis.binds.sonos.render(widgetID, instance);
            });
        },
    };
})(window.jQuery || window.$);
