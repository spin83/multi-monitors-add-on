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

const Lang = imports.lang;

const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;
const GnomeDesktop = imports.gi.GnomeDesktop;
const GObject = imports.gi.GObject;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Panel = imports.ui.panel;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const CtrlAltTab = imports.ui.ctrlAltTab;
const ExtensionSystem = imports.ui.extensionSystem;

const Config = imports.misc.config;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;
const MMCalendar = MultiMonitors.imports.mmcalendar;

const SHOW_ACTIVITIES_ID = 'show-activities';
var SHOW_APP_MENU_ID = 'show-app-menu';
const SHOW_DATE_TIME_ID = 'show-date-time';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';

var StatusIndicatorsController = new Lang.Class({
	Name: 'StatusIndicatorController',
	
	_init() {
		this._transfered_indicators = []; //{iname:, box:, monitor:}
		this._settings = Convenience.getSettings();
		
        this._updatedSessionId = Main.sessionMode.connect('updated', this._updateSessionIndicators.bind(this));
        this._updateSessionIndicators();
        this._extensionStateChangedId = ExtensionSystem.connect('extension-state-changed', 
        										this._extensionStateChanged.bind(this));

        this._transferIndicatorsId = this._settings.connect('changed::'+TRANSFER_INDICATORS_ID,
																		this.transferIndicators.bind(this));
	},
	
	destroy() {
		this._settings.disconnect(this._transferIndicatorsId);
		ExtensionSystem.disconnect(this._extensionStateChangedId);
		Main.sessionMode.disconnect(this._updatedSessionId);
		this._settings.set_strv(AVAILABLE_INDICATORS_ID, []);
		this._transferBack(this._transfered_indicators);
	},
	
	transferBack(panel) {
		let transfer_back = this._transfered_indicators.filter((element) => {
			return element.monitor==panel.monitorIndex;
		});
		
		this._transferBack(transfer_back, panel);
	},
	
	transferIndicators() {
		let boxs = ['_leftBox', '_centerBox', '_rightBox'];
    	let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
    	let show_app_menu = this._settings.get_value(SHOW_APP_MENU_ID);
    	
    	let transfer_back = this._transfered_indicators.filter((element) => {
    		return !transfers.hasOwnProperty(element.iname);
		});
    	
    	this._transferBack(transfer_back);
    	
		for(let iname in transfers) {
			if(transfers.hasOwnProperty(iname) && Main.panel.statusArea[iname]) {
				let monitor = transfers[iname];
				
				let indicator = Main.panel.statusArea[iname];
				let panel = this._findPanel(monitor);
				boxs.forEach((box) => {
					if(Main.panel[box].contains(indicator.container) && panel) {
						global.log('a '+box+ " > " + iname + " : "+ monitor);
						this._transfered_indicators.push({iname:iname, box:box, monitor:monitor});
						Main.panel[box].remove_child(indicator.container);
						if (show_app_menu && box === '_leftBox')
							panel[box].insert_child_at_index(indicator.container, 1);
						else
							panel[box].insert_child_at_index(indicator.container, 0);
					}
				});
			}
		}
	},
	
	_findPanel(monitor) {
		for (let i = 0; i < Main.mmPanel.length; i++) {
			if (Main.mmPanel[i].monitorIndex == monitor) {
				return Main.mmPanel[i];
			}
		}
		return null;
	},
	
	_transferBack(transfer_back, panel) {
    	transfer_back.forEach((element) => {
    		this._transfered_indicators.splice(this._transfered_indicators.indexOf(element));
			if(Main.panel.statusArea[element.iname]) {
				let indicator = Main.panel.statusArea[element.iname];
				if(!panel) {
					panel = this._findPanel(element.monitor);
				}
				if(panel[element.box].contains(indicator.container)) {
		    		global.log("r "+element.box+ " > " + element.iname + " : "+ element.monitor);
		    		panel[element.box].remove_child(indicator.container);
		    		if (element.box === '_leftBox')
		    			Main.panel[element.box].insert_child_at_index(indicator.container, 1);
		    		else
		    			Main.panel[element.box].insert_child_at_index(indicator.container, 0);
				}
			}
		});
	},
    
	_extensionStateChanged() {
		this._findAvailableIndicators();
        this.transferIndicators();
	},
	
	_updateSessionIndicators() {
        let session_indicators = [];
        session_indicators.push('MultiMonitorsAddOn');
        let sessionPanel = Main.sessionMode.panel;
        for (let sessionBox in sessionPanel){
        	sessionPanel[sessionBox].forEach((sesionIndicator) => {
        		session_indicators.push(sesionIndicator);
            });
        }
        this._session_indicators = session_indicators;
		this._available_indicators = [];
		
        this._findAvailableIndicators();
        this.transferIndicators();
	},
	
    _findAvailableIndicators() {
		let available_indicators = [];
		let statusArea = Main.panel.statusArea;
		for(let indicator in statusArea) {
			if(statusArea.hasOwnProperty(indicator) && this._session_indicators.indexOf(indicator)<0){
				available_indicators.push(indicator);
			}
		}
		if(available_indicators.length!=this._available_indicators.length) {
			this._available_indicators = available_indicators;
//			global.log(this._available_indicators);
			this._settings.set_strv(AVAILABLE_INDICATORS_ID, this._available_indicators);
		}
	}
});

var MultiMonitorsAppMenuButton = new Lang.Class({
    Name: 'MultiMonitorsAppMenuButton',
    Extends: Panel.AppMenuButton,
    
    _init(panel) {
    	if (panel.monitorIndex==undefined)
    		this._monitorIndex = Main.layoutManager.primaryIndex;
    	else	
    		this._monitorIndex = panel.monitorIndex;
    	this._actionOnWorkspaceGroupNotifyId = 0;
    	this._targetAppGroup = null;
    	this._lastFocusedWindow = null;
    	this.parent(panel);

	let display;
	display = global.screen || global.display;

	this._windowEnteredMonitorId = display.connect('window-entered-monitor',
		                					this._windowEnteredMonitor.bind(this));
	this._windowLeftMonitorId = display.connect('window-left-monitor',
		                					this._windowLeftMonitor.bind(this));
    },
    
    _windowEnteredMonitor (metaScreen, monitorIndex, metaWin) {
        if (monitorIndex == this._monitorIndex) {
        	switch(metaWin.get_window_type()){
        	case Meta.WindowType.NORMAL:
        	case Meta.WindowType.DIALOG:
        	case Meta.WindowType.MODAL_DIALOG:
        	case Meta.WindowType.SPLASHSCREEN:
        		this._sync();
        		break;
        	}
        }
    },

    _windowLeftMonitor (metaScreen, monitorIndex, metaWin) {
        if (monitorIndex == this._monitorIndex) {
        	switch(metaWin.get_window_type()){
        	case Meta.WindowType.NORMAL:
        	case Meta.WindowType.DIALOG:
        	case Meta.WindowType.MODAL_DIALOG:
        	case Meta.WindowType.SPLASHSCREEN:
        		this._sync();
        		break;
        	}
        }
    },
    
    _findTargetApp() {
    	
        if (this._actionOnWorkspaceGroupNotifyId) {
            this._targetAppGroup.disconnect(this._actionOnWorkspaceGroupNotifyId);
            this._actionOnWorkspaceGroupNotifyId = 0;
            this._targetAppGroup = null;
        }
        let groupWindow = false;
        let groupFocus = false;

        let display;
        display = global.screen || global.workspace_manager;

        let workspace = display.get_active_workspace();
        let tracker = Shell.WindowTracker.get_default();
        let focusedApp = tracker.focus_app;
        if (focusedApp && focusedApp.is_on_workspace(workspace)){
        	let windows = focusedApp.get_windows();
        	for (let i = 0; i < windows.length; i++) {
        		let win = windows[i];
        		if(win.located_on_workspace(workspace)){
        			if(win.get_monitor() == this._monitorIndex){
        				if(win.has_focus()){
        					this._lastFocusedWindow = win;
//    	        			global.log(this._monitorIndex+": focus :"+win.get_title()+" : "+win.has_focus());
    	        			return focusedApp;	
        				}
        				else
        					groupWindow = true;
        			}
        			else{
        				if(win.has_focus())
        					groupFocus = true;
        			}
        			if(groupFocus && groupWindow){
						if(focusedApp != this._targetApp){
    				        this._targetAppGroup = focusedApp;
    				        this._actionOnWorkspaceGroupNotifyId = this._targetAppGroup.connect('notify::action-group', 
    				        																this._sync.bind(this));
//    				        global.log(this._monitorIndex+": gConnect :"+win.get_title()+" : "+win.has_focus());
						}
        				break;
        			}
        		}
        	}
        }

        for (let i = 0; i < this._startingApps.length; i++)
            if (this._startingApps[i].is_on_workspace(workspace)){
//            	global.log(this._monitorIndex+": newAppFocus");
                return this._startingApps[i];
            }
        
        if (this._lastFocusedWindow && this._lastFocusedWindow.located_on_workspace(workspace) &&
        											this._lastFocusedWindow.get_monitor() == this._monitorIndex){
//			global.log(this._monitorIndex+": lastFocus :"+this._lastFocusedWindow.get_title());
			return tracker.get_window_app(this._lastFocusedWindow);
        }

        if (global.screen) 
        	display = global.screen.get_display();
        else 
        	display = global.display;
        	
        let windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);

        for (let i = 0; i < windows.length; i++) {
        	if(windows[i].get_monitor() == this._monitorIndex){
        		this._lastFocusedWindow = windows[i];
//        		global.log(this._monitorIndex+": appFind :"+windows[i].get_title());
    			return tracker.get_window_app(windows[i]);
    		}
        }

        return null;
    },
    destroy() {
    	if (this._actionGroupNotifyId) {
            this._targetApp.disconnect(this._actionGroupNotifyId);
            this._actionGroupNotifyId = 0;
        }

        let display;
        display = global.screen || global.display;

        display.disconnect(this._windowEnteredMonitorId);
        display.disconnect(this._windowLeftMonitorId);

    	this.parent();
	}
});

const MultiMonitorsActivitiesButton = new Lang.Class({
    Name: 'MultiMonitorsActivitiesButton',
    Extends: PanelMenu.Button,
    
	handleDragOver: Panel.ActivitiesButton.prototype["handleDragOver"],
	_onCapturedEvent: Panel.ActivitiesButton.prototype["_onCapturedEvent"],
	_onEvent: Panel.ActivitiesButton.prototype["_onEvent"],
	_onKeyRelease: Panel.ActivitiesButton.prototype["_onKeyRelease"],
	_xdndToggleOverview: Panel.ActivitiesButton.prototype["_xdndToggleOverview"],

    _init() {
        this.parent(0.0, null, true);
        this.actor.accessible_role = Atk.Role.TOGGLE_BUTTON;

        this.actor.name = 'mmPanelActivities';

        /* Translators: If there is no suitable word for "Activities"
           in your language, you can use the word for "Overview". */
        this._label = new St.Label({ text: _("Activities"),
                                     y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_actor(this._label);

        this.actor.label_actor = this._label;

        this.actor.connect('captured-event', this._onCapturedEvent.bind(this));
        this.actor.connect_after('key-release-event', this._onKeyRelease.bind(this));

        this._showingId = Main.overview.connect('showing', () => {
            this.actor.add_style_pseudo_class('overview');
            this.actor.add_accessible_state (Atk.StateType.CHECKED);
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.actor.remove_style_pseudo_class('overview');
            this.actor.remove_accessible_state (Atk.StateType.CHECKED);
        });
        
        this.actor.connect('destroy', this._onDestroy.bind(this));

        this._xdndTimeOut = 0;
    },
    
    _onDestroy(actor) {
	    Main.overview.disconnect(this._showingId);
	    Main.overview.disconnect(this._hidingId);
    }

});

const MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS = {
	    'activities': MultiMonitorsActivitiesButton,
//	    'aggregateMenu': Panel.AggregateMenu,
	    'appMenu': MultiMonitorsAppMenuButton,
	    'dateMenu': MMCalendar.MultiMonitorsDateMenuButton,
//	    'a11y': imports.ui.status.accessibility.ATIndicator,
//	    'keyboard': imports.ui.status.keyboard.InputSourceIndicator,
	};

var MultiMonitorsPanel = new Lang.Class({
    Name: 'MultiMonitorsPanel',
    Extends: Panel.Panel,

    _init (monitorIndex, mmPanelBox) {
    	this.monitorIndex = monitorIndex;
    	
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
    	
        this.actor = new Shell.GenericContainer({ name: 'panel', reactive: true });
        this.actor._delegate = this;
        
        this.actor.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this._sessionStyle = null;

        this.statusArea = {};

        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({ name: 'panelLeft' });
        this.actor.add_actor(this._leftBox);
        this._centerBox = new St.BoxLayout({ name: 'panelCenter' });
        this.actor.add_actor(this._centerBox);
        this._rightBox = new St.BoxLayout({ name: 'panelRight' });
        this.actor.add_actor(this._rightBox);

        this._leftCorner = new Panel.PanelCorner(St.Side.LEFT);
        this.actor.add_actor(this._leftCorner.actor);

        this._rightCorner = new Panel.PanelCorner(St.Side.RIGHT);
        this.actor.add_actor(this._rightCorner.actor);

        this.actor.connect('get-preferred-width', this._getPreferredWidth.bind(this));
        this.actor.connect('get-preferred-height', this._getPreferredHeight.bind(this));
        this.actor.connect('allocate', this._allocate.bind(this));
        this.actor.connect('button-press-event', this._onButtonPress.bind(this));
        if (this._currentVersion[0]==3 && this._currentVersion[1]>28) {
        	this.actor.connect('touch-event', this._onButtonPress.bind(this));
        }
        this.actor.connect('destroy', this._onDestroy.bind(this));
        
        if (this._currentVersion[0]==3 && this._currentVersion[1]>26) {
        	this.actor.connect('key-press-event', this._onKeyPress.bind(this));
        }
        
        this._showingId = Main.overview.connect('showing', () => {
            this.actor.add_style_pseudo_class('overview');
            if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
            	this._updateSolidStyle();
            }
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.actor.remove_style_pseudo_class('overview');
            if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
            	this._updateSolidStyle();
            }
        });

        mmPanelBox.panelBox.add(this.actor);
        
        Main.ctrlAltTabManager.addGroup(this.actor, _("Top Bar")+" "+this.monitorIndex, 'focus-top-bar-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });
                                        
        this._updatedId = Main.sessionMode.connect('updated', this._updatePanel.bind(this));
        
        if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
            this._trackedWindows = new Map();
            this._actorAddedId = global.window_group.connect('actor-added', this._onWindowActorAdded.bind(this));
            this._actorRemovedId = global.window_group.connect('actor-removed', this._onWindowActorRemoved.bind(this));
            this._switchWorkspaceId = global.window_manager.connect('switch-workspace', this._updateSolidStyle.bind(this));
            
            global.window_group.get_children().forEach(metaWindowActor => {
        		if (metaWindowActor['get_meta_window'] && metaWindowActor.get_meta_window().get_window_type() != Meta.WindowType.DESKTOP)
        			this._onWindowActorAdded(null, metaWindowActor);
            });
        }
        
        if (this._currentVersion[0]==3 && this._currentVersion[1]>26) {
		let display;
		//global.screen < 3.30
		display = global.screen || global.display;

		this._workareasChangedId = display.connect('workareas-changed', () => { this.actor.queue_relayout(); });
        }
        
        this._updatePanel();
        
        this._settings = Convenience.getSettings();
        this._showActivitiesId = this._settings.connect('changed::'+SHOW_ACTIVITIES_ID,
        													this._showActivities.bind(this));
        this._showActivities();

        this._showAppMenuId = this._settings.connect('changed::'+SHOW_APP_MENU_ID,
															this._showAppMenu.bind(this));
        this._showAppMenu();
        
        this._showDateTimeId = this._settings.connect('changed::'+SHOW_DATE_TIME_ID,
															this._showDateTime.bind(this));
        this._showDateTime();

    },
    
    _onDestroy(actor) {
    	
    	if (this._currentVersion[0]==3 && this._currentVersion[1]>26) {
		let display;
		display = global.screen || global.display;

		display.disconnect(this._workareasChangedId);
        }
    	
    	if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
            global.window_group.disconnect(this._actorAddedId);
            global.window_group.disconnect(this._actorRemovedId);
            global.window_manager.disconnect(this._switchWorkspaceId);
            
            this._trackedWindows.forEach((value, key, map) => {
            	value.forEach(id => {
            		key.disconnect(id);
                });
            });
    	}
    	
	    Main.overview.disconnect(this._showingId);
	    Main.overview.disconnect(this._hidingId);
	    this._settings.disconnect(this._showActivitiesId);
	    this._settings.disconnect(this._showAppMenuId);
//	    Tweener.removeTweens(actor);
	    
	    Main.ctrlAltTabManager.removeGroup(this.actor);
	    
	    Main.sessionMode.disconnect(this._updatedId);
	    
	    for (let name in this.statusArea) {
	    	if(this.statusArea.hasOwnProperty(name))
	    		this.statusArea[name].destroy();
	    	    delete this.statusArea[name];
	    }
	    
	    this.actor._delegate = null;
    },
    
    _showActivities() {
    	let name = 'activities';
    	if(this._settings.get_boolean(SHOW_ACTIVITIES_ID)){
    		if(this.statusArea[name])
    			this.statusArea[name].actor.visible = true;
    	}
    	else{
    		if(this.statusArea[name])
    			this.statusArea[name].actor.visible = false;
    	}
	},
	
	_showDateTime() {
    	let name = 'dateMenu';
    	if(this._settings.get_boolean(SHOW_DATE_TIME_ID)){
    		if(this.statusArea[name])
    			this.statusArea[name].actor.visible = true;
    	}
    	else{
    		if(this.statusArea[name])
    			this.statusArea[name].actor.visible = false;
    	}
	},
	
	_showAppMenu() {
		let name = 'appMenu';
    	if(this._settings.get_boolean(SHOW_APP_MENU_ID)){
    		if(!this.statusArea[name]){
    			let indicator = new MultiMonitorsAppMenuButton(this);
    			this.statusArea[name] = indicator;
    			let box = this._leftBox;
    			this._addToPanelBox(name, indicator, box.get_n_children()+1, box);
    		}
    	}
    	else{
    		if(this.statusArea[name]){
    			let indicator = this.statusArea[name];
    			this.menuManager.removeMenu(indicator.menu);
    			indicator.destroy();
    		}
    	}
	},

    _getPreferredWidth(actor, forHeight, alloc) {
        alloc.min_size = -1;
        if(Main.layoutManager.monitors.length>this.monitorIndex)
        	alloc.natural_size = Main.layoutManager.monitors[this.monitorIndex].width;
        else
        	alloc.natural_size = -1;
    },
    
    _updateSolidStyle() {
        if (this.actor.has_style_pseudo_class('overview') || !Main.sessionMode.hasWindows) {
            this._removeStyleClassName('solid');
            return;
        }

        if (!(Main.layoutManager.monitors.length>this.monitorIndex))
            return;

        /* Get all the windows in the active workspace that are in the primary monitor and visible */
        let display;
        display = global.screen || global.workspace_manager;
        let activeWorkspace = display.get_active_workspace();
        let monitorIndex = this.monitorIndex;
        let windows = activeWorkspace.list_windows().filter((metaWindow) => {
            return metaWindow.get_monitor() == monitorIndex &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() != Meta.WindowType.DESKTOP;
        });

        /* Check if at least one window is near enough to the panel */
        let [, panelTop] = this.actor.get_transformed_position();
        let panelBottom = panelTop + this.actor.get_height();
        let scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let isNearEnough = windows.some((metaWindow) => {
            let verticalPosition = metaWindow.get_frame_rect().y;
            return verticalPosition < panelBottom + 5 * scale;
        });

        if (isNearEnough)
            this._addStyleClassName('solid');
        else
            this._removeStyleClassName('solid');
    },

    
    _hideIndicators() {
        for (let role in MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS) {
            let indicator = this.statusArea[role];
            if (!indicator)
                continue;
            if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
	            if (indicator.menu)
	                indicator.menu.close();
            }
            indicator.container.hide();
        }
    },

    _ensureIndicator(role) {
        let indicator = this.statusArea[role];
        if (!indicator) {
            let constructor = MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS[role];
            if (!constructor) {
                return null;
            }
            indicator = new constructor(this);
            this.statusArea[role] = indicator;
        }
        return indicator;
    }
});
