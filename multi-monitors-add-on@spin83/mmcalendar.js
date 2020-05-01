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

const { St, Gio, Shell, Clutter, GnomeDesktop, GObject, GLib } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const MessageList = imports.ui.messageList;
const DateMenu = imports.ui.dateMenu;
const Calendar = imports.ui.calendar;

const ExtensionUtils = imports.misc.extensionUtils;
const CE = ExtensionUtils.getCurrentExtension();
const MultiMonitors = CE.imports.extension;
const Convenience = CE.imports.convenience;

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

const MultiMonitorsCalendar34 = class MultiMonitorsCalendar34 {
    constructor() {
        this._weekStart = Shell.util_get_week_start();
        this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });

        this._showWeekdateKeyId = this._settings.connect(`changed::${Calendar.SHOW_WEEKDATE_KEY}`, this._onSettingsChange.bind(this));
        this._useWeekdate = this._settings.get_boolean(Calendar.SHOW_WEEKDATE_KEY);

        this._headerFormatWithoutYear = _('%OB');
        this._headerFormat = _('%OB %Y');

        // Start off with the current date
        this._selectedDate = new Date();

        this._shouldDateGrabFocus = false;

        this.actor = new St.Widget({ style_class: 'calendar',
                                     layout_manager: new Clutter.TableLayout(),
                                     reactive: true });

        this.actor.connect('scroll-event', this._onScroll.bind(this));
        
        this.actor.connect('destroy', this._onDestroy.bind(this));

        this._buildHeader ();
    }
    
    _onDestroy(actor) {
    	this._settings.disconnect(this._showWeekdateKeyId);
    }
};
Signals.addSignalMethods(MultiMonitorsCalendar34.prototype);
MultiMonitors.copyClass(Calendar.Calendar, MultiMonitorsCalendar34);

var MultiMonitorsEventsSection = (() => {
	if (MultiMonitors.gnomeShellVersion()[1]<36)
		return null;
	let MultiMonitorsEventsSection = class MultiMonitorsEventsSection extends MessageList.MessageListSection {
	    _init() {
	        super._init();
	
	        this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
	        this._reloadEventsId = this._desktopSettings.connect('changed', this._reloadEvents.bind(this));
	        this._eventSource = new Calendar.EmptyEventSource();
	
	        this._messageById = new Map();
	
	        this._title = new St.Button({ style_class: 'events-section-title',
	                                      label: '',
	                                      can_focus: true });
	        this._title.child.x_align = Clutter.ActorAlign.START;
	        this.insert_child_below(this._title, null);
	
	        this._title.connect('clicked', this._onTitleClicked.bind(this));
	        this._title.connect('key-focus-in', this._onKeyFocusIn.bind(this));
	
			this._appSys = Shell.AppSystem.get_default();
	        this._appInstalledChangedId = this._appSys.connect('installed-changed',
	                                              this._appInstalledChanged.bind(this));

			this.connect('destroy', this._onDestroy.bind(this));
	        this._appInstalledChanged();
	    }

	    _onDestroy() {
	    	this._desktopSettings.disconnect(this._reloadEventsId);
	    	this._appSys.disconnect(this._appInstalledChangedId);
	    }
	};
	MultiMonitors.copyClass(Calendar.EventsSection, MultiMonitorsEventsSection);
	return GObject.registerClass(MultiMonitorsEventsSection);
})();

const MultiMonitorsEventsSection34 = class MultiMonitorsEventsSection34 extends MessageList.MessageListSection {
	constructor() {
		super();

        this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._reloadEventsId = this._desktopSettings.connect('changed', this._reloadEvents.bind(this));
        this._eventSource = new Calendar.EmptyEventSource();
        
        this._messageById = new Map();

        this._title = new St.Button({ style_class: 'events-section-title',
                                      label: '',
                                      x_align: St.Align.START,
                                      can_focus: true });
        this.actor.insert_child_below(this._title, null);

        this._title.connect('clicked', this._onTitleClicked.bind(this));
        this._title.connect('key-focus-in', this._onKeyFocusIn.bind(this));

        this._defaultAppSystem = Shell.AppSystem.get_default(); 
        this._appInstalledChangedId = this._defaultAppSystem.connect('installed-changed',
                                              this._appInstalledChanged.bind(this));
        
        this.actor.connect('destroy', this._onDestroy.bind(this));
        this._appInstalledChanged();
    }
    
    _onDestroy(actor) {
    	this._desktopSettings.disconnect(this._reloadEventsId);
    	this._defaultAppSystem.disconnect(this._appInstalledChangedId);
    }
};
MultiMonitors.copyClass(Calendar.EventsSection, MultiMonitorsEventsSection34);

var MultiMonitorsNotificationSection = (() => {
	if (MultiMonitors.gnomeShellVersion()[1]<36)
		return null;
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
	    }
	};
	MultiMonitors.copyClass(Calendar.NotificationSection, MultiMonitorsNotificationSection);
	return GObject.registerClass(MultiMonitorsNotificationSection);
})();

const MultiMonitorsNotificationSection34 = class MultiMonitorsNotificationSectione34 extends MessageList.MessageListSection {
    constructor() {
    	super();

    	this._sources = new Map();
        this._nUrgent = 0;

        this._sourceAddedId = Main.messageTray.connect('source-added', this._sourceAdded.bind(this));
        Main.messageTray.getSources().forEach((source) => {
            this._sourceAdded(Main.messageTray, source);
        });

        this.actor.connect('notify::mapped', this._onMapped.bind(this));
        this.actor.connect('destroy', this._onDestroy.bind(this));
    }
    
    _onDestroy(actor) {
    	Main.messageTray.disconnect(this._sourceAddedId);
    	let source, obj;
    	for ([source, obj] of this._sources.entries()) {
    		this._onSourceDestroy(source, obj);
    	}
    }
};
MultiMonitors.copyClass(Calendar.NotificationSection, MultiMonitorsNotificationSection34);

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
	
	        this._dndSwitch = new Calendar.DoNotDisturbSwitch();
	        this._dndButton = new St.Button({
	            can_focus: true,
	            toggle_mode: true,
	            child: this._dndSwitch,
	            label_actor: dndLabel,
	        });
	        this._dndButton.bind_property('checked',
	            this._dndSwitch, 'state',
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
	
	        this._eventsSection = new MultiMonitorsEventsSection();
	        this._addSection(this._eventsSection);
	
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
	    }
	};
	MultiMonitors.copyClass(Calendar.CalendarMessageList, MultiMonitorsCalendarMessageList);
	return GObject.registerClass(MultiMonitorsCalendarMessageList);
})();

const MultiMonitorsCalendarMessageList34 = class MultiMonitorsCalendarMessageList34 {
    constructor() {
        this.actor = new St.Widget({ style_class: 'message-list',
                                     layout_manager: new Clutter.BinLayout(),
                                     x_expand: true, y_expand: true });

        this._placeholder = new Calendar.Placeholder();
        this.actor.add_actor(this._placeholder.actor);

        let box = new St.BoxLayout({ vertical: true,
                                     x_expand: true, y_expand: true });
        this.actor.add_actor(box);

        this._scrollView = new St.ScrollView({ style_class: 'vfade',
                                               overlay_scrollbars: true,
                                               x_expand: true, y_expand: true,
                                               x_fill: true, y_fill: true });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        box.add_actor(this._scrollView);

        this._clearButton = new St.Button({ style_class: 'message-list-clear-button button',
                                            label: _("Clear"),
                                            can_focus: true });
        this._clearButton.set_x_align(Clutter.ActorAlign.END);
        this._clearButton.connect('clicked', () => {
            let sections = [...this._sections.keys()];
            sections.forEach((s) => { s.clear(); });
        });
        box.add_actor(this._clearButton);

        this._sectionList = new St.BoxLayout({ style_class: 'message-list-sections',
                                               vertical: true,
                                               y_expand: true,
                                               y_align: Clutter.ActorAlign.START });
        this._scrollView.add_actor(this._sectionList);
        this._sections = new Map();
        
        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', this._sync.bind(this));

        this._notificationSection = new MultiMonitorsNotificationSection34();
        this._addSection(this._notificationSection);
        this._eventsSection = new MultiMonitorsEventsSection34();
        this._addSection(this._eventsSection);
        
        this.actor.connect('destroy', this._onDestroy.bind(this));
    }
    
    _onDestroy(actor) {
    	this._destroyed = true;
    	Main.sessionMode.disconnect(this._sessionModeUpdatedId);
    	this._sessionModeUpdatedId = 0;
    }
    
    _sync() {
    	if (this._sessionModeUpdatedId === 0) return;
    	Calendar.CalendarMessageList.prototype._sync.call(this);
    }
};
MultiMonitors.copyClass(Calendar.CalendarMessageList, MultiMonitorsCalendarMessageList34);

var MultiMonitorsDateMenuButton  = (() => {
	let MultiMonitorsDateMenuButton = class MultiMonitorsDateMenuButton extends PanelMenu.Button {
	    _init() {
	    	let hbox;
	    	let vbox;

			let box;
	    	if (MultiMonitors.gnomeShellVersion()[1]<36) {
		        let menuAlignment = 0.5;
		        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
		            menuAlignment = 1.0 - menuAlignment;
		        super._init(menuAlignment);
		
		        this._clockDisplay = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
		//        this._indicator = new DateMenu.MessagesIndicator();
		
		        box = new St.BoxLayout();
		//        box.add_actor(new DateMenu.IndicatorPad(this._indicator.actor));
		        box.add_actor(this._clockDisplay);
		//        box.add_actor(this._indicator.actor);
			}
			else {
		        super._init(0.5);
		
		        this._clockDisplay = new St.Label({ style_class: 'clock' });
		        this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
		
		        this._indicator = new DateMenu.MessagesIndicator();
		
		        const indicatorPad = new St.Widget();
		        this._indicator.bind_property('visible',
		            indicatorPad, 'visible',
		            GObject.BindingFlags.SYNC_CREATE);
		        indicatorPad.add_constraint(new Clutter.BindConstraint({
		            source: this._indicator,
		            coordinate: Clutter.BindCoordinate.SIZE,
		        }));
		
		        box = new St.BoxLayout({ style_class: 'clock-display-box' });
		        box.add_actor(indicatorPad);
		        box.add_actor(this._clockDisplay);
		        box.add_actor(this._indicator);
			}
	
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
			if (MultiMonitors.gnomeShellVersion()[1]<36) {
	        	this._calendar = new MultiMonitorsCalendar34();
		        this._calendar.connect('selected-date-changed',
		                               (calendar, date) => {
		                                   layout.frozen = !DateMenu._isToday(date);
		                                   this._messageList.setDate(date);
		                               });
			}
			else {
				this._calendar = new MultiMonitorsCalendar();
		        this._calendar.connect('selected-date-changed', (_calendar, datetime) => {
		            let date = DateMenu._gDateTimeToDate(datetime);
		            layout.frozen = !DateMenu._isToday(date);
		            this._messageList.setDate(date);
		        });
			}
	
	        this.menu.connect('open-state-changed', (menu, isOpen) => {
	            // Whenever the menu is opened, select today
	            if (isOpen) {
	                let now = new Date();
	                this._calendar.setDate(now);
	                this._date.setDate(now);
	                this._messageList.setDate(now);
	            }
	        });
	
			
	        // Fill up the first column
			let calendar_actor;
			if (MultiMonitors.gnomeShellVersion()[1]<36) {
	        	this._messageList = new MultiMonitorsCalendarMessageList34();
				hbox.add(this._messageList.actor, { expand: true, y_fill: false, y_align: St.Align.START });
				calendar_actor = this._calendar.actor;
			}
			else {
	        	this._messageList = new MultiMonitorsCalendarMessageList();
				hbox.add_child(this._messageList);
				calendar_actor = this._calendar;
			}
	
	        // Fill up the second column
	        let boxLayout = new DateMenu.CalendarColumnLayout(calendar_actor);
	        vbox = new St.Widget({ style_class: 'datemenu-calendar-column',
	                               layout_manager: boxLayout });
	        boxLayout.hookup_style(vbox);
	        hbox.add(vbox);
	        
	        this._date = new DateMenu.TodayButton(this._calendar);
			if (MultiMonitors.gnomeShellVersion()[1]<36) {
		        vbox.add_actor(this._date.actor);
		
		        vbox.add_actor(this._calendar.actor);
			}
			else {
		        vbox.add_actor(this._date);
		
		        vbox.add_actor(this._calendar);
			}
	
	        this._displaysSection = {};
	
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
	    }
	};
	MultiMonitors.copyClass(DateMenu.DateMenuButton, MultiMonitorsDateMenuButton);
	return GObject.registerClass(MultiMonitorsDateMenuButton);
})();
