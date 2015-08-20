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
const Gio = imports.gi.Gio;

const Main = imports.ui.main;
const Panel = imports.ui.panel;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;
const MMPanel = MultiMonitors.imports.mmpanel;
const MMOverview = MultiMonitors.imports.mmoverview;
const MMIndicator = MultiMonitors.imports.indicator;

const OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_PANEL_ID = 'show-panel';
const SHOW_THUMBNAILS_SLIDER_ID = 'show-thumbnails-slider';
const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_APP_MENU_ID = 'show-app-menu';
const THUMBNAILS_ON_LEFT_SIDE_ID = 'thumbnails-on-left-side';

const MultiMonitorsAddOn = new Lang.Class({
	Name: 'MultiMonitorsAddOn',
	
	_init: function() {
		this._settings = Convenience.getSettings();
		
		this._ov_settings = new Gio.Settings({ schema: OVERRIDE_SCHEMA });
		
		this.mmIndicator = null;
		Main.mmOverview = null;
		Main.mmPanel = null;
		this.panelBox = null;
		this.mmappMenu = false;
		
		this._showAppMenuId = null;
		
		this._mmMonitors = 0;
	},
	
	_changeMainPanelAppMenuButton: function(appMenuButton) {
		let role = "appMenu";
		let panel = Main.panel;
		let indicator = panel.statusArea[role];
		panel.menuManager.removeMenu(indicator.menu);
		indicator.destroy();
		if (indicator._actionGroupNotifyId) {
			indicator._targetApp.disconnect(indicator._actionGroupNotifyId);
			indicator._actionGroupNotifyId = 0;
        }
		indicator = new appMenuButton(panel);
		panel.statusArea[role] = indicator;
		let box = panel._leftBox;
		panel._addToPanelBox(role, indicator, box.get_n_children()+1, box);
	},
	
	_showIndicator: function() {
		if(this._settings.get_boolean(SHOW_INDICATOR_ID)) {
			if(!this.mmIndicator) {
				this.mmIndicator = Main.panel.addToStatusArea('MultiMonitorsAddOn', new MMIndicator.MultiMonitorsIndicator());
			}
		}
		else {
			this._hideIndicator();
		}
	},
	
	_hideIndicator: function() {
		if(this.mmIndicator) {
			this.mmIndicator.destroy();
			this.mmIndicator = null;
		}
	},
	
	_showPanel: function() {
		if(this._settings.get_boolean(SHOW_PANEL_ID)){
			Main.mmPanel = [];
			this.panelBox = [];
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
				if(i != Main.layoutManager.primaryIndex) {
					let panel = new MMPanel.MultiMonitorsPanel(i);
			        this.panelBox[i] = new St.BoxLayout({ name: 'panelBox'+i, vertical: true });
			        Main.layoutManager.addChrome(this.panelBox[i], { affectsStruts: true, trackFullscreen: true });
			        this.panelBox[i].set_position(monitor.x, monitor.y);
			        this.panelBox[i].set_size(monitor.width, -1);
			        Main.uiGroup.set_child_below_sibling(this.panelBox[i], Main.layoutManager.panelBox);
		//			this.panelBox.connect('allocation-changed', Lang.bind(this, this._panelBoxChanged));
					this.panelBox[i].add(panel.actor);
					
					Main.mmPanel[i] = panel;
				}
			}
			
			this.statusIndicatorsController = new MMPanel.StatusIndicatorsController();
			
			if (Main.mmPanel.length>1) {
		        this._showAppMenuId = this._settings.connect('changed::'+SHOW_APP_MENU_ID, Lang.bind(this, this._showAppMenu));
				this._showAppMenu();
			}
			
			if(Main.mmOverview){
				for (let i = 0; i < Main.mmOverview.length; i++) {
					if(Main.mmOverview[i])
						Main.mmOverview[i].addPanelGhost();
				}
			}
		}
		else{
			this._hidePanel();
		}
			
	},
	
	_showAppMenu: function(){
		if(this._settings.get_boolean(SHOW_APP_MENU_ID)){
			this._changeMainPanelAppMenuButton(MMPanel.MultiMonitorsAppMenuButton);
			this.mmappMenu = true;
		}
		else{
			if(this.mmappMenu){
				this._changeMainPanelAppMenuButton(Panel.AppMenuButton);
				this.mmappMenu = false;
			}
		}
	},
	
	_hidePanel: function() {
		if(Main.mmPanel){
			if(this._showAppMenuId) {
				this._settings.disconnect(this._showAppMenuId);
				this._showAppMenuId = null;
			}
			
			this.statusIndicatorsController.destroy();
			this.statusIndicatorsController = null;
			
			for (let i = 0; i < Main.mmPanel.length; i++) {
				if(Main.mmPanel[i])
					this.panelBox[i].destroy();
			}
			
			Main.mmPanel = null;
			this.panelBox = null;
			
			if(this.mmappMenu){
				this._changeMainPanelAppMenuButton(Panel.AppMenuButton);
				this.mmappMenu = false;
			}
			
			if(Main.mmOverview){
				for (let i = 0; i < Main.mmOverview.length; i++) {
					if(Main.mmOverview[i])
						Main.mmOverview[i].removePanelGhost();
				}
			}
		}
	},
	
	_showThumbnailsSlider: function() {
		if(this._settings.get_boolean(SHOW_THUMBNAILS_SLIDER_ID)){
			
			if(this._ov_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
				this._ov_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);
			
			Main.mmOverview = [];
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
				if(i != Main.layoutManager.primaryIndex) {
					Main.mmOverview[i] = new MMOverview.MultiMonitorsOverview(i);
					Main.mmOverview[i].init();
				}
			}
		}
		else{
			this._hideThumbnailsSlider();
		}
	},
	
	_hideThumbnailsSlider: function() {
		if(Main.mmOverview){
			for (let i = 0; i < Main.mmOverview.length; i++) {
				if(Main.mmOverview[i])
					Main.mmOverview[i].destroy();
			}
			
			Main.mmOverview = null;
		}
	},
	
	_relayout: function() {
		
		if(this._mmMonitors!=Main.layoutManager.monitors.length){
			this._mmMonitors = Main.layoutManager.monitors.length;
			global.log("pi:"+Main.layoutManager.primaryIndex);
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
					global.log("i:"+i+" x:"+monitor.x+" y:"+monitor.y+" w:"+monitor.width+" h:"+monitor.height);	
			}
			this._hideThumbnailsSlider();
			this._hidePanel();
			this._showPanel();
			this._showThumbnailsSlider();
		}
	},
	
	_switchOffThumbnails: function() {
		if(this._ov_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
			this._settings.set_boolean(SHOW_THUMBNAILS_SLIDER_ID, false);
	},
	
	
	
	enable: function() {
		global.log("Enable Multi Monitors Add-On ...")

		this._switchOffThumbnailsId = this._ov_settings.connect('changed::'+WORKSPACES_ONLY_ON_PRIMARY_ID,
																				Lang.bind(this, this._switchOffThumbnails));
		
		this._showIndicator();
		
		this._relayoutId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._relayout));
		
		this._showIndicatorId = this._settings.connect('changed::'+SHOW_INDICATOR_ID, Lang.bind(this, this._showIndicator));
		this._showPanelId = this._settings.connect('changed::'+SHOW_PANEL_ID, Lang.bind(this, this._showPanel));
		this._showThumbnailsSliderId = this._settings.connect('changed::'+SHOW_THUMBNAILS_SLIDER_ID, Lang.bind(this, this._showThumbnailsSlider));
		
		this._relayout();
	},
	
	disable: function() {
		Main.layoutManager.disconnect(this._relayoutId);
		
		this._settings.disconnect(this._showPanelId);
		this._settings.disconnect(this._showThumbnailsSliderId);

		this._hideThumbnailsSlider();
		this._hidePanel();
		this._mmMonitors = 0;
		
		this._hideIndicator();
		
		this._ov_settings.disconnect(this._switchOffThumbnailsId);
		global.log("Disable Multi Monitors Add-On ...")
	}
});

function init(extensionMeta) {
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(extensionMeta.path + "/icons");
	return new MultiMonitorsAddOn();
}
