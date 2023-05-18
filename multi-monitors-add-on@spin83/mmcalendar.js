/*
Copyright (C) 2014  spin83

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

const Signals = imports.signals;

const { St, Gio, Shell, Clutter, GnomeDesktop, Pango, GObject, GLib } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const MessageList = imports.ui.messageList;
const DateMenu = imports.ui.dateMenu;
const Calendar = imports.ui.calendar;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const CE = ExtensionUtils.getCurrentExtension();
const MultiMonitors = CE.imports.extension;
const Convenience = CE.imports.convenience;

// Calendar.DoNotDisturbSwitch is const, so not exported. Either
// <https://gjs.guide/guides/gobject/subclassing.html#gtypename> is untrue, or
// GObject.type_from_name() is broken, so we can't get its constructor via GI
// either. Luckily it's a short class, so we can copy & paste.
const MultiMonitorsDoNotDisturbSwitch = GObject.registerClass(
class MultiMonitorsDoNotDisturbSwitch extends PopupMenu.Switch {
    _init() {
        this._settings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });

        super._init(this._settings.get_boolean('show-banners'));

        this._settings.bind('show-banners',
            this, 'state',
            Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this.connect('destroy', () => {
            this._settings.run_dispose();
            this._settings = null;
        });
    }
});

var MultiMonitorsCalendar = (() => {
	let MultiMonitorsCalendar = class MultiMonitorsCalendar extends St.Widget {
	    _init () {
	        this._weekStart = Shell.util_get_week_start();
	        this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });
	
	        this._showWeekdateKeyId = this._settings.connect('changed::%s'.format(Calendar.SHOW_WEEKDATE_KEY), this._onSettingsChange.bind(this));
	        this._useWeekdate = this._settings.get_boolean(Calendar.SHOW_WEEKDATE_KEY);
	
	        this._headerFormatWithoutYear = _('%OB');
	        this._headerFormat = _('%OB %Y');
	
	        // Start off with the current date
	        this._selectedDate = new Date();
	
	        this._shouldDateGrabFocus = false;
	
	        super._init({
	            style_class: 'calendar',
	            layout_manager: new Clutter.GridLayout(),
	            reactive: true,
	        });
	
	        this._buildHeader();
			this.connect('destroy', this._onDestroy.bind(this));
	    }
	    
	    _onDestroy() {
	    	this._settings.disconnect(this._showWeekdateKeyId);
	    }
	};
	MultiMonitors.copyClass(Calendar.Calendar, MultiMonitorsCalendar);
	return GObject.registerClass({
    	Signals: { 'selected-date-changed': { param_types: [GLib.DateTime.$gtype] } },
		}, MultiMonitorsCalendar);
})();

var MultiMonitorsEventsSection = (() => {
    let MultiMonitorsEventsSection = class MultiMonitorsEventsSection extends St.Button {
    _init() {
        super._init({
            style_class: 'events-button',
            can_focus: true,
            x_expand: true,
            child: new St.BoxLayout({
                style_class: 'events-box',
                vertical: true,
                x_expand: true,
            }),
        });

        this._startDate = null;
        this._endDate = null;

        this._eventSource = null;
        this._calendarApp = null;

        this._title = new St.Label({
            style_class: 'events-title',
        });
        this.child.add_child(this._title);

        this._eventsList = new St.BoxLayout({
            style_class: 'events-list',
            vertical: true,
            x_expand: true,
        });
        this.child.add_child(this._eventsList);

        this._appSys = Shell.AppSystem.get_default();
        this._appInstalledChangedId = this._appSys.connect('installed-changed',
            this._appInstalledChanged.bind(this));
        this._appInstalledChanged();

        this.connect('destroy', this._onDestroy.bind(this));
        this._appInstalledChanged();
    }

    _onDestroy() {
        this._appSys.disconnect(this._appInstalledChangedId);
    }};

    MultiMonitors.copyClass(DateMenu.EventsSection, MultiMonitorsEventsSection);
	return GObject.registerClass(MultiMonitorsEventsSection);
})();

var MultiMonitorsNotificationSection = (() => {
    let MultiMonitorsNotificationSection = class MultiMonitorsNotificationSection extends MessageList.MessageListSection {
    _init() {
        super._init();

        this._sources = new Map();
        this._nUrgent = 0;

        this._sourceAddedId = Main.messageTray.connect('source-added', this._sourceAdded.bind(this));
        Main.messageTray.getSources().forEach(source => {
            this._sourceAdded(Main.messageTray, source);
        });

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        Main.messageTray.disconnect(this._sourceAddedId);
        let source, obj;
        for ([source, obj] of this._sources.entries()) {
            this._onSourceDestroy(source, obj);
        }
    }};

    MultiMonitors.copyClass(Calendar.NotificationSection, MultiMonitorsNotificationSection);
    return GObject.registerClass(MultiMonitorsNotificationSection);
})();

var MultiMonitorsCalendarMessageList = (() => {
	let MultiMonitorsCalendarMessageList = class MultiMonitorsCalendarMessageList extends St.Widget {
    _init() {
        super._init({
            style_class: 'message-list',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._sessionModeUpdatedId = 0;

        this._placeholder = new Calendar.Placeholder();
        this.add_actor(this._placeholder);

        let box = new St.BoxLayout({ vertical: true,
                                     x_expand: true, y_expand: true });
        this.add_actor(box);

        this._scrollView = new St.ScrollView({
            style_class: 'vfade',
            overlay_scrollbars: true,
            x_expand: true, y_expand: true,
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        box.add_actor(this._scrollView);

        let hbox = new St.BoxLayout({ style_class: 'message-list-controls' });
        box.add_child(hbox);

        const dndLabel = new St.Label({
            text: _('Do Not Disturb'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        hbox.add_child(dndLabel);

        this._dndSwitch = new MultiMonitorsDoNotDisturbSwitch();
        this._dndButton = new St.Button({
            can_focus: true,
            toggle_mode: true,
            child: this._dndSwitch,
            label_actor: dndLabel,
        });

        this._dndSwitch.bind_property('state',
                this._dndButton, 'checked',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

        hbox.add_child(this._dndButton);

        this._clearButton = new St.Button({
            style_class: 'message-list-clear-button button',
            label: _('Clear'),
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        this._clearButton.connect('clicked', () => {
            this._sectionList.get_children().forEach(s => s.clear());
        });
        hbox.add_actor(this._clearButton);

        this._placeholder.bind_property('visible',
            this._clearButton, 'visible',
            GObject.BindingFlags.INVERT_BOOLEAN);

        this._sectionList = new St.BoxLayout({ style_class: 'message-list-sections',
                                               vertical: true,
                                               x_expand: true,
                                               y_expand: true,
                                               y_align: Clutter.ActorAlign.START });
        this._sectionList.connect('actor-added', this._sync.bind(this));
        this._sectionList.connect('actor-removed', this._sync.bind(this));
        this._scrollView.add_actor(this._sectionList);

        this._notificationSection = new MultiMonitorsNotificationSection();
        this._addSection(this._notificationSection);

        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', this._sync.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        Main.sessionMode.disconnect(this._sessionModeUpdatedId);
        this._sessionModeUpdatedId = 0;
    }

    _sync() {
        if (this._sessionModeUpdatedId === 0) return;
        Calendar.CalendarMessageList.prototype._sync.call(this);
    }};

    MultiMonitors.copyClass(Calendar.CalendarMessageList, MultiMonitorsCalendarMessageList);
    return GObject.registerClass(MultiMonitorsCalendarMessageList);
})();

var MultiMonitorsMessagesIndicator  = (() => {
    let MultiMonitorsMessagesIndicator = class MultiMonitorsMessagesIndicator extends St.Icon {
    _init() {
        super._init({
            icon_size: 16,
            visible: false,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._sources = [];
        this._count = 0;

        this._settings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });
        this._settings.connect('changed::show-banners', this._sync.bind(this));

        this._sourceAddedId = Main.messageTray.connect('source-added', this._onSourceAdded.bind(this));
        this._sourceRemovedId = Main.messageTray.connect('source-removed', this._onSourceRemoved.bind(this));
        this._queueChangedId = Main.messageTray.connect('queue-changed', this._updateCount.bind(this));

        let sources = Main.messageTray.getSources();
        sources.forEach(source => this._onSourceAdded(null, source));

        this._sync();

        this.connect('destroy', () => {
            this._settings.run_dispose();
            this._settings = null;
            Main.messageTray.disconnect(this._sourceAddedId);
            Main.messageTray.disconnect(this._sourceRemovedId);
            Main.messageTray.disconnect(this._queueChangedId);
        });
    }};

    MultiMonitors.copyClass(DateMenu.MessagesIndicator, MultiMonitorsMessagesIndicator);
    return GObject.registerClass(MultiMonitorsMessagesIndicator);
})();

var MultiMonitorsDateMenuButton  = (() => {
    let MultiMonitorsDateMenuButton = class MultiMonitorsDateMenuButton extends PanelMenu.Button {
    _init() {
        let hbox;
        let vbox;

        super._init(0.5);

        this._clockDisplay = new St.Label({ style_class: 'clock' });
        this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this._indicator = new MultiMonitorsMessagesIndicator();

        const indicatorPad = new St.Widget();
        this._indicator.bind_property('visible',
            indicatorPad, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        indicatorPad.add_constraint(new Clutter.BindConstraint({
            source: this._indicator,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));

        let box = new St.BoxLayout({ style_class: 'clock-display-box' });
        box.add_actor(indicatorPad);
        box.add_actor(this._clockDisplay);
        box.add_actor(this._indicator);

        this.label_actor = this._clockDisplay;
        this.add_actor(box);
        this.add_style_class_name('clock-display');

        let layout = new DateMenu.FreezableBinLayout();
        let bin = new St.Widget({ layout_manager: layout });
        // For some minimal compatibility with PopupMenuItem
        bin._delegate = this;
        this.menu.box.add_child(bin);

        hbox = new St.BoxLayout({ name: 'calendarArea' });
        bin.add_actor(hbox);

        this._calendar = new MultiMonitorsCalendar();
        this._calendar.connect('selected-date-changed', (_calendar, datetime) => {
            let date = DateMenu._gDateTimeToDate(datetime);
            layout.frozen = !DateMenu._isToday(date);
            this._eventsItem.setDate(date);
        });
        this._date = new DateMenu.TodayButton(this._calendar);

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            // Whenever the menu is opened, select today
            if (isOpen) {
                let now = new Date();
                this._calendar.setDate(now);
                this._date.setDate(now);
                this._eventsItem.setDate(now);
            }
        });

        // Fill up the first column
        this._messageList = new MultiMonitorsCalendarMessageList();
        hbox.add_child(this._messageList);

        // Fill up the second column
        const boxLayout = new DateMenu.CalendarColumnLayout([this._calendar, this._date]);
        vbox = new St.Widget({ style_class: 'datemenu-calendar-column',
                               layout_manager: boxLayout });
        boxLayout.hookup_style(vbox);
        hbox.add(vbox);

        vbox.add_actor(this._date);
        vbox.add_actor(this._calendar);

        this._displaysSection = new St.ScrollView({ style_class: 'datemenu-displays-section vfade',
                                                    x_expand: true,
                                                    overlay_scrollbars: true });
        this._displaysSection.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
        vbox.add_actor(this._displaysSection);

        let displaysBox = new St.BoxLayout({ vertical: true,
                                             x_expand: true,
                                             style_class: 'datemenu-displays-box' });
        this._displaysSection.add_actor(displaysBox);

        this._eventsItem = new MultiMonitorsEventsSection();
        displaysBox.add_child(this._eventsItem);

        this._clock = new GnomeDesktop.WallClock();
        this._clock.bind_property('clock', this._clockDisplay, 'text', GObject.BindingFlags.SYNC_CREATE);
        this._clockNotifyTimezoneId = this._clock.connect('notify::timezone', this._updateTimeZone.bind(this));

        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();
    }

    _onDestroy() {
        Main.sessionMode.disconnect(this._sessionModeUpdatedId);
        this._clock.disconnect(this._clockNotifyTimezoneId);
        super._onDestroy();
    }};

    MultiMonitors.copyClass(DateMenu.DateMenuButton, MultiMonitorsDateMenuButton);
    return GObject.registerClass(MultiMonitorsDateMenuButton);
})();

