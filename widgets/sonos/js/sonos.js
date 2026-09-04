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
        version: '4.1.0',
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
                emptyFavorites: 'No favorites. Add them in the Sonos app first.',
                emptyPlaylists: 'No playlists. Create them in the Sonos app first.',
                emptyQueue: 'Queue is empty.',
                emptyRecent: 'No recent tracks yet. They appear after something is played.',
                unknown: 'Unknown room',
                nothing: 'Nothing playing',
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
                emptyFavorites: 'Keine Favoriten. Lege sie zuerst in der Sonos-App an.',
                emptyPlaylists: 'Keine Playlists. Lege sie zuerst in der Sonos-App an.',
                emptyQueue: 'Die Warteschlange ist leer.',
                emptyRecent: 'Noch keine Titel. Die Liste füllt sich beim Abspielen.',
                unknown: 'Unbekannter Raum',
                nothing: 'Nichts spielt',
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
            $div.data('sonos-tab', $div.data('sonos-tab') || 'favorites');
            $div.data('sonos-player', $div.data('sonos-player') || '');

            vis.binds.sonos.unbind(widgetID);

            if (!instance) {
                $div.html('<div class="sonos-ctrl"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(vis.binds.sonos.t('hint')) + '</div></div>');
                return;
            }

            var paint = function () {
                try {
                    vis.binds.sonos.render(widgetID, instance);
                    vis.binds.sonos.bindStates(widgetID, instance);
                } catch (err) {
                    $div.html('<div class="sonos-ctrl"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(String(err)) + '</div></div>');
                }
            };

            paint();
            vis.binds.sonos.loadStates(instance, paint);
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
                        'current_title',
                        'current_artist',
                        'current_album',
                        'current_station',
                        'current_cover',
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
                    ].forEach(function (name) {
                        ids.push(player.id + '.' + name);
                    });
                });

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
                    'current_title',
                    'current_artist',
                    'current_album',
                    'current_station',
                    'current_cover',
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
                ].forEach(function (name) {
                    ids.push(player.id + '.' + name);
                });
            });

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
            });
        },

        isGroupedWith: function (player, other) {
            var coordA = String(vis.binds.sonos.state(player.id, 'coordinator') || player.ip);
            var coordB = String(vis.binds.sonos.state(other.id, 'coordinator') || other.ip);
            return coordA && coordA === coordB;
        },

        render: function (widgetID, instance) {
            var $div = $('#' + widgetID);
            if (!$div.length) {
                return;
            }

            var t = vis.binds.sonos.t;
            var players = vis.binds.sonos.findPlayers(instance);
            if (!players.length) {
                $div.html('<div class="sonos-ctrl"><div class="sonos-ctrl-hint">' + vis.binds.sonos.esc(t('noPlayers')) + '</div></div>');
                return;
            }

            var selectedIp = $div.data('sonos-player');
            var selected = players.filter(function (player) { return player.ip === selectedIp; })[0] || players[0];
            $div.data('sonos-player', selected.ip);
            var tab = $div.data('sonos-tab') || 'favorites';
            var mediaId = vis.binds.sonos.mediaPlayerId(selected);
            var playing = vis.binds.sonos.state(mediaId, 'state') === 'play';
            var title = vis.binds.sonos.state(mediaId, 'current_title') || vis.binds.sonos.state(mediaId, 'current_station') || t('nothing');
            var artist = vis.binds.sonos.state(mediaId, 'current_artist');
            var album = vis.binds.sonos.state(mediaId, 'current_album');
            var station = vis.binds.sonos.state(mediaId, 'current_station');
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
            var shuffle = !!vis.binds.sonos.state(mediaId, 'shuffle');
            var repeat = parseInt(vis.binds.sonos.state(mediaId, 'repeat'), 10) || 0;
            var elapsed = vis.binds.sonos.state(mediaId, 'current_elapsed_s') || '00:00';
            var duration = vis.binds.sonos.state(mediaId, 'current_duration_s') || '00:00';
            var coordinator = String(vis.binds.sonos.state(selected.id, 'coordinator') || selected.ip);
            var groupVolume = parseInt(vis.binds.sonos.state(mediaId, 'group_volume'), 10);
            var grouped = players.filter(function (player) {
                return vis.binds.sonos.isGroupedWith(selected, player);
            });

            var roomsHtml = players.map(function (player) {
                var isActive = player.ip === selected.ip;
                var isPlaying = vis.binds.sonos.state(vis.binds.sonos.mediaPlayerId(player), 'state') === 'play';
                var alive = vis.binds.sonos.state(player.id, 'alive') !== false;
                return '<button type="button" class="sonos-ctrl-chip' +
                    (isActive ? ' is-active' : '') +
                    (isPlaying ? ' is-playing' : '') +
                    (alive ? '' : ' is-offline') +
                    '" data-ip="' + vis.binds.sonos.esc(player.ip) + '">' +
                    vis.binds.sonos.esc(player.name) +
                    '</button>';
            }).join('');

            var groupHtml = players.filter(function (player) { return player.ip !== selected.ip; }).map(function (player) {
                var checked = vis.binds.sonos.isGroupedWith(selected, player) ? ' checked' : '';
                return '<label><input type="checkbox" data-group-ip="' + vis.binds.sonos.esc(player.ip) + '"' + checked + '> ' +
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
            if (tab === 'favorites') {
                var favorites = vis.binds.sonos.parseFavorites(mediaId);
                listHtml = favorites.length
                    ? favorites.map(function (item) {
                        return '<button type="button" class="sonos-ctrl-item" data-favorite="' + vis.binds.sonos.esc(item.title) + '">' +
                            (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                            '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t('emptyFavorites')) + '</div>';
            } else if (tab === 'playlists') {
                var playlists = vis.binds.sonos.parseList(
                    vis.binds.sonos.state(mediaId, 'playlist_list_array') || vis.binds.sonos.state(mediaId, 'playlist_list')
                );
                listHtml = playlists.length
                    ? playlists.map(function (name) {
                        return '<button type="button" class="sonos-ctrl-item" data-playlist="' + vis.binds.sonos.esc(name) + '">' +
                            '<div class="sonos-ctrl-thumb"></div><div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(name) + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t('emptyPlaylists')) + '</div>';
            } else if (tab === 'recent') {
                var recent = vis.binds.sonos.parseRecent(selected.id);
                listHtml = recent.length
                    ? recent.map(function (item) {
                        return '<button type="button" class="sonos-ctrl-item" data-recent-uri="' + vis.binds.sonos.esc(item.uri || '') + '" data-recent-title="' + vis.binds.sonos.esc(item.title) + '">' +
                            (item.cover ? '<img src="' + vis.binds.sonos.esc(item.cover) + '" alt="">' : '<div class="sonos-ctrl-thumb"></div>') +
                            '<div><div class="sonos-ctrl-item-title">' + vis.binds.sonos.esc(item.title) + '</div>' +
                            '<div class="sonos-ctrl-item-sub">' + vis.binds.sonos.esc(item.artist || item.album || item.station || '') + '</div></div></button>';
                    }).join('')
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t('emptyRecent')) + '</div>';
            } else {
                var queue = vis.binds.sonos.parseQueue(mediaId);
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
                    : '<div class="sonos-ctrl-empty">' + vis.binds.sonos.esc(t('emptyQueue')) + '</div>';
            }

            var sub = [artist, album || station].filter(Boolean).join(' — ');
            var coverStyle = cover ? ' style="background-image:url(\'' + vis.binds.sonos.esc(cover) + '\')"' : '';

            $div.html(
                '<div class="sonos-ctrl">' +
                    '<div class="sonos-ctrl-header">' +
                        '<div class="sonos-ctrl-brand">SONOS</div>' +
                        '<span class="sonos-ctrl-ver">' + vis.binds.sonos.esc(vis.binds.sonos.version) + '</span>' +
                        '<div class="sonos-ctrl-rooms">' + roomsHtml + '</div>' +
                    '</div>' +
                    '<div class="sonos-ctrl-main">' +
                        '<div class="sonos-ctrl-cover"' + coverStyle + '>' + (cover ? '' : 'SONOS') + '</div>' +
                        '<div class="sonos-ctrl-meta">' +
                            '<div class="sonos-ctrl-title">' + vis.binds.sonos.esc(title) + '</div>' +
                            '<div class="sonos-ctrl-sub">' + vis.binds.sonos.esc(sub) + '</div>' +
                            '<div class="sonos-ctrl-buttons">' +
                                '<button type="button" class="sonos-ctrl-btn" data-cmd="prev" title="Prev">&#9198;</button>' +
                                '<button type="button" class="sonos-ctrl-btn sonos-ctrl-btn-play" data-cmd="' + (playing ? 'pause' : 'play') + '" title="Play/Pause">' + (playing ? '&#10073;&#10073;' : '&#9654;') + '</button>' +
                                '<button type="button" class="sonos-ctrl-btn" data-cmd="next" title="Next">&#9197;</button>' +
                                '<button type="button" class="sonos-ctrl-btn' + (muted ? ' is-on' : '') + '" data-cmd="mute" title="Mute">' + (muted ? '&#128263;' : '&#128266;') + '</button>' +
                                '<button type="button" class="sonos-ctrl-btn' + (shuffle ? ' is-on' : '') + '" data-cmd="shuffle" title="Shuffle">&#128256;</button>' +
                                '<button type="button" class="sonos-ctrl-btn' + (repeat ? ' is-on' : '') + '" data-cmd="repeat" title="Repeat">' + (repeat === 2 ? '1' : '&#128257;') + '</button>' +
                            '</div>' +
                            '<div class="sonos-ctrl-seek">' +
                                '<span class="sonos-ctrl-time">' + vis.binds.sonos.esc(elapsed) + '</span>' +
                                '<input type="range" min="0" max="100" step="1" class="sonos-ctrl-seek-input" value="' + seek + '">' +
                                '<span class="sonos-ctrl-time">' + vis.binds.sonos.esc(duration) + '</span>' +
                            '</div>' +
                            '<div class="sonos-ctrl-volume">' +
                                '<span>Vol</span>' +
                                '<input type="range" min="0" max="100" step="1" class="sonos-ctrl-volume-input" value="' + volume + '">' +
                                '<span class="sonos-ctrl-time">' + volume + '</span>' +
                            '</div>' +
                            '<div class="sonos-ctrl-groups">' + groupHtml + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="sonos-ctrl-tabs">' +
                        '<button type="button" class="sonos-ctrl-tab' + (tab === 'favorites' ? ' is-active' : '') + '" data-tab="favorites">' + vis.binds.sonos.esc(t('favorites')) + '</button>' +
                        '<button type="button" class="sonos-ctrl-tab' + (tab === 'playlists' ? ' is-active' : '') + '" data-tab="playlists">' + vis.binds.sonos.esc(t('playlists')) + '</button>' +
                        '<button type="button" class="sonos-ctrl-tab' + (tab === 'queue' ? ' is-active' : '') + '" data-tab="queue">' + vis.binds.sonos.esc(t('queue')) + '</button>' +
                        '<button type="button" class="sonos-ctrl-tab' + (tab === 'recent' ? ' is-active' : '') + '" data-tab="recent">' + vis.binds.sonos.esc(t('recent')) + '</button>' +
                    '</div>' +
                    '<div class="sonos-ctrl-list">' + listHtml + '</div>' +
                '</div>'
            );

            vis.binds.sonos.bindUi($div, selected, players, coordinator, mediaId);
            vis.binds.sonos.startTicker(widgetID, instance);
        },

        bindUi: function ($div, selected, players, coordinator, mediaId) {
            mediaId = mediaId || selected.id;
            $div.find('.sonos-ctrl-chip').on('click', function () {
                $div.data('sonos-player', $(this).data('ip'));
                vis.binds.sonos.render($div.attr('id'), vis.binds.sonos.resolveInstance(selected.id));
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

            $div.find('[data-tab]').on('click', function () {
                $div.data('sonos-tab', $(this).data('tab'));
                vis.binds.sonos.render($div.attr('id'), vis.binds.sonos.resolveInstance(selected.id));
            });

            $div.find('[data-favorite]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.favorites_set', String($(this).attr('data-favorite')));
            });
            $div.find('[data-playlist]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.playlist_set', String($(this).attr('data-playlist')));
            });
            $div.find('[data-track]').on('click', function () {
                vis.binds.sonos.write(mediaId + '.current_track_number', parseInt($(this).data('track'), 10));
            });
            $div.find('[data-recent-title]').on('click', function () {
                var uri = String($(this).attr('data-recent-uri') || '');
                var recentTitle = String($(this).attr('data-recent-title') || '');
                if (uri && !/^x-rincon:RINCON_/i.test(uri)) {
                    vis.binds.sonos.write(mediaId + '.play_uri', uri);
                } else if (recentTitle) {
                    vis.binds.sonos.write(mediaId + '.favorites_set', recentTitle);
                }
            });
        },
    };
})(window.jQuery || window.$);
