'use strict';

/*
 * Socket bridge for the SONOS instance-link page.
 *
 * The page is served by the web adapter at /sonos/. Same origin as socket.io
 * (`../lib/js/socket.io.js`) and `/_socket/info.js` (socketUrl / session).
 *
 * Exposes the small `vis` surface that widgets/sonos/js/sonos.js already talks
 * to: states, objects, setValue, conn.getStates / subscribe / getObjectView.
 */
(function (window) {
    var binders = {};
    var subscribed = {};
    var socket = null;
    var connectWaiters = [];
    var lastError = '';

    function notify(id) {
        var key = id + '.val';
        var list = binders[key] || [];
        for (var i = 0; i < list.length; i++) {
            try {
                list[i]();
            } catch (e) {
                // ignore handler errors
            }
        }
    }

    function applyOne(id, state) {
        if (!id) {
            return;
        }
        if (!state) {
            vis.states[id + '.val'] = null;
            notify(id);
            return;
        }
        vis.states[id + '.val'] = state.val;
        vis.states[id + '.ack'] = state.ack;
        vis.states[id + '.ts'] = state.ts;
        notify(id);
    }

    function applyStates(data) {
        if (!data) {
            return;
        }
        Object.keys(data).forEach(function (id) {
            applyOne(id, data[id]);
        });
    }

    function unwrap(err, result) {
        if (err && !result && err.rows) {
            return { err: null, result: err };
        }
        return { err: err || null, result: result };
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () {
                resolve(src);
            };
            s.onerror = function () {
                reject(new Error(src));
            };
            document.head.appendChild(s);
        });
    }

    function ensureIo() {
        if (typeof window.io === 'function' || (window.io && typeof window.io.connect === 'function')) {
            return Promise.resolve();
        }
        var candidates = [
            '../lib/js/socket.io.js',
            '/lib/js/socket.io.js',
            '../../lib/js/socket.io.js',
            '/socket.io/socket.io.js',
        ];
        var i = 0;
        function next() {
            if (i >= candidates.length) {
                return Promise.reject(new Error('socket.io'));
            }
            return loadScript(candidates[i++]).then(function () {
                if (typeof window.io === 'function' || (window.io && window.io.connect)) {
                    return;
                }
                return next();
            }, next);
        }
        return next();
    }

    function openSocket() {
        var opts = {
            query: { key: window.socketSession || '' },
            rememberUpgrade: true,
        };
        if (window.socketForceWebSockets) {
            opts.transports = ['websocket'];
        }
        var url = window.socketUrl;
        if (typeof window.io === 'function') {
            return window.io(url || undefined, opts);
        }
        return window.io.connect(url || undefined, opts);
    }

    function emitAuth(user, password) {
        return new Promise(function (resolve, reject) {
            if (!socket || typeof socket.emit !== 'function') {
                reject(new Error('socket'));
                return;
            }
            var settled = false;
            function finish(ok) {
                if (settled) {
                    return;
                }
                settled = true;
                if (ok === false) {
                    reject(new Error('auth'));
                    return;
                }
                resolve();
            }
            try {
                socket.emit('name', 'sonos-gui');
            } catch (e) {
                // optional
            }
            var timer = setTimeout(function () {
                finish(true);
            }, 1200);
            try {
                if (user) {
                    socket.emit('authenticate', user, password || '', function (isOk) {
                        clearTimeout(timer);
                        finish(isOk);
                    });
                } else {
                    socket.emit('authenticate', function (isOk) {
                        clearTimeout(timer);
                        finish(isOk);
                    });
                }
            } catch (e2) {
                clearTimeout(timer);
                finish(true);
            }
        });
    }

    function bindSocketEvents() {
        socket.on('stateChange', function (id, state) {
            applyOne(id, state);
        });
        socket.on('disconnect', function () {
            lastError = 'disconnect';
            SonosWww._setStatus('error');
        });
        socket.on('connect', function () {
            if (SonosWww.authenticated) {
                SonosWww._setStatus('ok');
            }
        });
        socket.on('reauthenticate', function () {
            SonosWww.authenticated = false;
            SonosWww._setStatus('auth');
        });
    }

    var states = {};
    states.bind = function (key, handler) {
        binders[key] = binders[key] || [];
        binders[key].push(handler);
    };
    states.unbind = function (key, handler) {
        binders[key] = (binders[key] || []).filter(function (fn) {
            return fn !== handler;
        });
    };
    states.attr = function (key, value) {
        if (arguments.length < 2) {
            return states[key];
        }
        states[key] = value;
        return states;
    };

    var conn = {
        get _socket() {
            return socket;
        },
        get socket() {
            return socket;
        },
        getStates: function (ids, cb) {
            if (typeof ids === 'function') {
                cb = ids;
                ids = null;
            }
            if (!socket) {
                if (cb) {
                    cb('no socket', {});
                }
                return;
            }
            var done = function (err, data) {
                var pack = unwrap(err, data);
                if (pack.result) {
                    applyStates(pack.result);
                }
                if (cb) {
                    cb(pack.err, pack.result || {});
                }
            };
            if (ids == null) {
                socket.emit('getStates', done);
                return;
            }
            socket.emit('getStates', ids, function (err, data) {
                if (err && Array.isArray(ids)) {
                    var prefixes = {};
                    ids.forEach(function (id) {
                        var match = String(id).match(/^(sonos\.\d+)/);
                        if (match) {
                            prefixes[match[1] + '.*'] = true;
                        }
                    });
                    var keys = Object.keys(prefixes);
                    if (!keys.length) {
                        done(err, {});
                        return;
                    }
                    var merged = {};
                    var left = keys.length;
                    keys.forEach(function (pattern) {
                        socket.emit('getStates', pattern, function (e2, part) {
                            Object.assign(merged, part || {});
                            left -= 1;
                            if (left <= 0) {
                                done(null, merged);
                            }
                        });
                    });
                    return;
                }
                done(err, data);
            });
        },
        subscribe: function (ids) {
            if (!socket) {
                return;
            }
            var list = Array.isArray(ids) ? ids : [ids];
            var patterns = {};
            list.forEach(function (id) {
                var match = String(id || '').match(/^(sonos\.\d+)/);
                patterns[match ? match[1] + '.*' : id] = true;
            });
            Object.keys(patterns).forEach(function (pattern) {
                if (!pattern || subscribed[pattern]) {
                    return;
                }
                subscribed[pattern] = true;
                try {
                    socket.emit('subscribe', pattern);
                } catch (e) {
                    // ignore
                }
                try {
                    socket.emit('subscribeStates', pattern);
                } catch (e2) {
                    // older web adapters only have subscribe
                }
            });
        },
        getObjectView: function (design, search, params, cb) {
            if (!socket) {
                if (cb) {
                    cb('no socket', { rows: [] });
                }
                return;
            }
            socket.emit('getObjectView', design, search, params, function (err, result) {
                var pack = unwrap(err, result);
                if (cb) {
                    cb(pack.err, pack.result || { rows: [] });
                }
            });
        },
        getObject: function (id, cb) {
            if (!socket) {
                if (cb) {
                    cb('no socket');
                }
                return;
            }
            socket.emit('getObject', id, function (err, obj) {
                var pack = unwrap(err, obj);
                if (cb) {
                    cb(pack.err, pack.result);
                }
            });
        },
    };

    window.vis = window.vis || {};
    vis.language = String((navigator.language || 'de')).substring(0, 2);
    vis.binds = vis.binds || {};
    vis.objects = vis.objects || {};
    vis.states = states;
    vis.conn = conn;
    vis.setValue = function (id, value) {
        if (!id || !socket) {
            return;
        }
        socket.emit('setState', id, value);
    };

    function flushWaiters(error) {
        var list = connectWaiters;
        connectWaiters = [];
        list.forEach(function (item) {
            if (error) {
                item.reject(error);
            } else {
                item.resolve();
            }
        });
    }

    window.SonosWww = {
        authenticated: false,
        lastError: function () {
            return lastError;
        },
        _setStatus: function () {
            // filled by app.js
        },
        connect: function (user, password) {
            return ensureIo()
                .then(function () {
                    if (!socket) {
                        socket = openSocket();
                        bindSocketEvents();
                    }
                    return new Promise(function (resolve, reject) {
                        if (socket.connected) {
                            resolve();
                            return;
                        }
                        var timer = setTimeout(function () {
                            reject(new Error('timeout'));
                        }, 8000);
                        function once(event, handler) {
                            if (typeof socket.once === 'function') {
                                socket.once(event, handler);
                                return;
                            }
                            var wrap = function () {
                                if (typeof socket.removeListener === 'function') {
                                    socket.removeListener(event, wrap);
                                }
                                handler.apply(null, arguments);
                            };
                            socket.on(event, wrap);
                        }
                        once('connect', function () {
                            clearTimeout(timer);
                            resolve();
                        });
                        once('connect_error', function (err) {
                            clearTimeout(timer);
                            reject(err || new Error('connect'));
                        });
                    });
                })
                .then(function () {
                    return emitAuth(user, password);
                })
                .then(function () {
                    SonosWww.authenticated = true;
                    lastError = '';
                    return loadConfig();
                });
        },
        ready: function () {
            return new Promise(function (resolve, reject) {
                if (SonosWww.authenticated && socket) {
                    resolve();
                    return;
                }
                connectWaiters.push({ resolve: resolve, reject: reject });
            });
        },
        start: function () {
            return SonosWww.connect().then(function () {
                flushWaiters();
            }, function (err) {
                lastError = err && err.message ? err.message : String(err || 'error');
                flushWaiters(err);
                throw err;
            });
        },
        loadInstances: loadInstances,
        applyStates: applyStates,
    };

    function loadConfig() {
        return new Promise(function (resolve) {
            conn.getObject('system.config', function (err, obj) {
                if (obj && obj.common && obj.common.language) {
                    vis.language = String(obj.common.language).substring(0, 2);
                }
                resolve();
            });
        });
    }

    function loadInstances() {
        return new Promise(function (resolve) {
            conn.getObjectView('system', 'instance', {
                startkey: 'system.adapter.sonos.',
                endkey: 'system.adapter.sonos.\u9999',
            }, function (err, res) {
                var rows = (res && res.rows) || [];
                var list = [];
                rows.forEach(function (row) {
                    var id = row.id || row._id || '';
                    var num = id.split('.').pop();
                    if (/^\d+$/.test(num)) {
                        list.push({ id: 'sonos.' + num, instance: num, title: 'sonos.' + num });
                    }
                });
                if (list.length) {
                    resolve(list);
                    return;
                }
                conn.getStates('sonos.*', function (e2, statesMap) {
                    var found = {};
                    Object.keys(statesMap || {}).forEach(function (id) {
                        var match = id.match(/^(sonos\.\d+)/);
                        if (match) {
                            found[match[1]] = true;
                        }
                    });
                    resolve(Object.keys(found).sort().map(function (id) {
                        return { id: id, instance: id.split('.')[1], title: id };
                    }));
                });
            });
        });
    }
})(window);
