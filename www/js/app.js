'use strict';

/*
 * Boots the vis-1 Sonos Control widget on the instance-link page.
 *
 * Query: ?instance=0 (or sonos.0), ?theme=dark|light|midnight, ?kiosk=1
 */
(function () {
    var WIDGET = 'sonos_web';
    var THEMES = ['dark', 'light', 'midnight'];
    var words = {
        en: {
            connecting: 'Connecting to ioBroker…',
            connected: 'Online',
            disconnected: 'Offline',
            auth: 'Sign-in required',
            login: 'Sign in',
            user: 'User',
            password: 'Password',
            loginError: 'Sign-in failed.',
            instance: 'Instance',
            noSocket: 'The web adapter did not serve socket.io. Open this page as the instance link (web adapter, /sonos/), not as a local file.',
            timeout: 'No connection to the web adapter. Is web.0 running?',
            noInstance: 'No SONOS instance found. Start sonos.x in admin.',
            dark: 'Dark',
            light: 'Light',
            midnight: 'Midnight',
        },
        de: {
            connecting: 'Verbinde mit ioBroker…',
            connected: 'Verbunden',
            disconnected: 'Getrennt',
            auth: 'Anmeldung nötig',
            login: 'Anmelden',
            user: 'Benutzer',
            password: 'Passwort',
            loginError: 'Anmeldung fehlgeschlagen.',
            instance: 'Instanz',
            noSocket: 'Der Web-Adapter hat socket.io nicht geliefert. Die Seite über den Instanzlink öffnen (Web-Adapter, /sonos/), nicht als lokale Datei.',
            timeout: 'Keine Verbindung zum Web-Adapter. Läuft web.0?',
            noInstance: 'Keine SONOS-Instanz gefunden. sonos.x im Admin starten.',
            dark: 'Dunkel',
            light: 'Hell',
            midnight: 'Mitternacht',
        },
    };

    function lang() {
        var code = String((window.vis && vis.language) || navigator.language || 'de').substring(0, 2);
        return words[code] ? code : 'en';
    }

    function t(key) {
        return (words[lang()] && words[lang()][key]) || words.en[key] || key;
    }

    function $(id) {
        return document.getElementById(id);
    }

    function query() {
        return new URLSearchParams(window.location.search);
    }

    function readTheme() {
        var fromQuery = String(query().get('theme') || '').toLowerCase();
        if (THEMES.indexOf(fromQuery) !== -1) {
            return fromQuery;
        }
        try {
            var stored = String(window.localStorage.getItem('iobroker.sonos.www.theme') || '');
            if (THEMES.indexOf(stored) !== -1) {
                return stored;
            }
        } catch (e) {
            // ignore
        }
        return 'dark';
    }

    function saveTheme(theme) {
        try {
            window.localStorage.setItem('iobroker.sonos.www.theme', theme);
        } catch (e) {
            // ignore
        }
    }

    function readInstance() {
        var raw = String(query().get('instance') || '').trim();
        if (/^\d+$/.test(raw)) {
            return 'sonos.' + raw;
        }
        if (/^sonos\.\d+$/.test(raw)) {
            return raw;
        }
        try {
            var stored = String(window.localStorage.getItem('iobroker.sonos.www.instance') || '');
            if (/^sonos\.\d+$/.test(stored)) {
                return stored;
            }
        } catch (e) {
            // ignore
        }
        return '';
    }

    function saveInstance(id) {
        try {
            window.localStorage.setItem('iobroker.sonos.www.instance', id);
        } catch (e) {
            // ignore
        }
    }

    function setStatus(state) {
        var el = $('sonos-www-status');
        if (!el) {
            return;
        }
        el.dataset.state = state;
        if (state === 'ok') {
            el.textContent = t('connected');
        } else if (state === 'auth') {
            el.textContent = t('auth');
        } else if (state === 'error') {
            el.textContent = t('disconnected');
        } else {
            el.textContent = t('connecting');
        }
    }

    function showOverlay(message, login) {
        var overlay = $('sonos-www-overlay');
        var msg = $('sonos-www-msg');
        var form = $('sonos-www-login');
        overlay.hidden = false;
        msg.textContent = message;
        form.hidden = !login;
        if (login) {
            $('sonos-www-user-label').textContent = t('user');
            $('sonos-www-pass-label').textContent = t('password');
            $('sonos-www-login-btn').textContent = t('login');
        }
    }

    function hideOverlay() {
        $('sonos-www-overlay').hidden = true;
        $('sonos-www-login').hidden = true;
        $('sonos-www-login-error').hidden = true;
    }

    function paintThemes(current) {
        var host = $('sonos-www-themes');
        host.innerHTML = '';
        THEMES.forEach(function (theme) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = t(theme);
            btn.className = theme === current ? 'is-on' : '';
            btn.addEventListener('click', function () {
                saveTheme(theme);
                var url = new URL(window.location.href);
                url.searchParams.set('theme', theme);
                window.history.replaceState({}, '', url);
                mountWidget(readInstance() || host.dataset.instance, theme);
                paintThemes(theme);
            });
            host.appendChild(btn);
        });
    }

    function paintInstances(list, selected) {
        var wrap = $('sonos-www-instance-wrap');
        var select = $('sonos-www-instance');
        $('sonos-www-instance-label').textContent = t('instance');
        select.innerHTML = '';
        list.forEach(function (item) {
            var opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.title;
            if (item.id === selected) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
        wrap.classList.toggle('is-hidden', list.length < 2);
        wrap.dataset.instance = selected;
        select.onchange = function () {
            var id = select.value;
            saveInstance(id);
            var url = new URL(window.location.href);
            url.searchParams.set('instance', id.split('.')[1]);
            window.history.replaceState({}, '', url);
            mountWidget(id, readTheme());
        };
    }

    function readRoom() {
        var raw = String(query().get('room') || '').trim();
        if (!raw) {
            return '';
        }
        return raw.replace(/[.\s]+/g, '_');
    }

    function mountWidget(instance, theme) {
        if (!instance || !window.jQuery || !vis.binds || !vis.binds.sonos) {
            return;
        }
        var $div = window.jQuery('#' + WIDGET);
        if (vis.binds.sonos.stopTicker) {
            vis.binds.sonos.stopTicker(WIDGET);
        }
        if (vis.binds.sonos.unbind) {
            vis.binds.sonos.unbind(WIDGET);
        }
        $div.removeData();
        $div.off();
        $div.empty();
        var room = readRoom();
        if (room && vis.binds.sonos.saveRoom) {
            vis.binds.sonos.saveRoom(WIDGET, instance, room);
        }
        vis.binds.sonos.createWidget(WIDGET, 'www', { oid: instance, theme: theme });
        $('sonos-www-ver').textContent = vis.binds.sonos.version || '';
    }

    function boot(instances) {
        hideOverlay();
        setStatus('ok');
        var selected = readInstance();
        if (!selected || !instances.some(function (item) { return item.id === selected; })) {
            selected = instances[0].id;
        }
        saveInstance(selected);
        paintInstances(instances, selected);
        paintThemes(readTheme());
        mountWidget(selected, readTheme());
    }

    function explain(err) {
        var code = err && err.message ? err.message : String(err || '');
        if (code === 'socket.io') {
            return t('noSocket');
        }
        if (code === 'timeout' || code === 'connect') {
            return t('timeout');
        }
        if (code === 'auth') {
            return t('auth');
        }
        return t('timeout');
    }

    function start(user, password) {
        setStatus('connecting');
        showOverlay(t('connecting'), false);
        return SonosWww.connect(user, password).then(function () {
            return SonosWww.loadInstances();
        }).then(function (instances) {
            if (!instances.length) {
                setStatus('error');
                showOverlay(t('noInstance'), false);
                return;
            }
            boot(instances);
        }).catch(function (err) {
            var code = err && err.message ? err.message : '';
            if (code === 'auth') {
                setStatus('auth');
                showOverlay(t('auth'), true);
                if (user) {
                    $('sonos-www-login-error').hidden = false;
                    $('sonos-www-login-error').textContent = t('loginError');
                }
                return;
            }
            setStatus('error');
            showOverlay(explain(err), false);
        });
    }

    SonosWww._setStatus = setStatus;

    if (query().get('kiosk') === '1') {
        document.getElementById('sonos-www').classList.add('is-kiosk');
    }

    $('sonos-www-login').addEventListener('submit', function (event) {
        event.preventDefault();
        $('sonos-www-login-error').hidden = true;
        start($('sonos-www-user').value, $('sonos-www-pass').value).catch(function () {
            $('sonos-www-login-error').hidden = false;
            $('sonos-www-login-error').textContent = t('loginError');
        });
    });

    if (!window.jQuery) {
        showOverlay('jQuery missing', false);
        return;
    }

    start();
})();
