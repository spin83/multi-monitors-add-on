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

const Gio = imports.gi.Gio;

const Main = imports.ui.main;

const WorkspacesView = imports.ui.workspacesView;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const MMLayout = MultiMonitors.imports.mmlayout;
const MMOverview = MultiMonitors.imports.mmoverview;
const MMIndicator = MultiMonitors.imports.indicator;

const Config = imports.misc.config;

const OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
const MUTTER_SCHEMA = 'org.gnome.mutter';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_THUMBNAILS_SLIDER_ID = 'show-thumbnails-slider';

const MultiMonitorsAddOn = new Lang.Class({
	Name: 'MultiMonitorsAddOn',
	
	_init: function() {
		this._settings = Convenience.getSettings();
		this._ov_settings = new Gio.Settings({ schema: OVERRIDE_SCHEMA });
		this._mu_settings = new Gio.Settings({ schema: MUTTER_SCHEMA });
		
		this._currentVersion = Config.PACKAGE_VERSION.split('.');
		
		this.mmIndicator = null;
		Main.mmOverview = null;
		Main.mmLayoutManager = null;
		
		this._mmMonitors = 0;
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
	
	_showThumbnailsSlider: function() {
		if(this._settings.get_boolean(SHOW_THUMBNAILS_SLIDER_ID)){
			
			if(this._ov_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
				this._ov_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);
			if(this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
				this._mu_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);
			
			Main.mmOverview = [];
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
				if(i != Main.layoutManager.primaryIndex) {
					Main.mmOverview[i] = new MMOverview.MultiMonitorsOverview(i);
					Main.mmOverview[i].init();
				}
			}
			
			if (Main.overview.visible)
				return;
			
			let workspacesDisplay = Main.overview.viewSelector._workspacesDisplay;
			if (workspacesDisplay._restackedNotifyId === undefined) {
				workspacesDisplay._restackedNotifyId = 0;
			}
			workspacesDisplay.hide();
			workspacesDisplay.actor._delegate = null;
			workspacesDisplay.actor.destroy();
			Main.overview.viewSelector._workspacesPage.hide();
			Main.overview.viewSelector._workspacesPage.destroy();
			
			workspacesDisplay = new MMOverview.MultiMonitorsWorkspacesDisplay();
			Main.overview.viewSelector._workspacesDisplay = workspacesDisplay;
			Main.overview.viewSelector._workspacesPage = Main.overview.viewSelector._addPage(workspacesDisplay.actor,
	                                             _("Windows"), 'focus-windows-symbolic');
			if (Main.overview.visible) {
				Main.overview._controls._updateWorkspacesGeometry();
				Main.overview.viewSelector._workspacesPage.show();
				workspacesDisplay.show();
			}
		}
		else{
			this._hideThumbnailsSlider();
		}
	},
	
	_hideThumbnailsSlider: function() {
		if (Main.mmOverview) {
			
			if (!Main.overview.visible) {
				let workspacesDisplay = Main.overview.viewSelector._workspacesDisplay;
				workspacesDisplay.hide();
				workspacesDisplay.actor._delegate = null;
				workspacesDisplay.actor.destroy();
				Main.overview.viewSelector._workspacesPage.hide();
				Main.overview.viewSelector._workspacesPage.destroy();
				
				workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
				Main.overview.viewSelector._workspacesDisplay = workspacesDisplay;
				Main.overview.viewSelector._workspacesPage = Main.overview.viewSelector._addPage(workspacesDisplay.actor,
		                                             _("Windows"), 'focus-windows-symbolic');
			}
			
			for (let i = 0; i < Main.mmOverview.length; i++) {
				if(Main.mmOverview[i])
					Main.mmOverview[i].destroy();
			}
			Main.mmOverview = null;
		}
	},
	
	_relayout: function() {
//		global.log(".....................................................................")
		if(this._mmMonitors!=Main.layoutManager.monitors.length){
			this._mmMonitors = Main.layoutManager.monitors.length;
			global.log("pi:"+Main.layoutManager.primaryIndex);
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
					global.log("i:"+i+" x:"+monitor.x+" y:"+monitor.y+" w:"+monitor.width+" h:"+monitor.height);	
			}
			this._hideThumbnailsSlider();
			this._showThumbnailsSlider();
		}
	},
	
	_switchOffThumbnails: function() {
		if(this._ov_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
			this._settings.set_boolean(SHOW_THUMBNAILS_SLIDER_ID, false);
		if(this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
			this._settings.set_boolean(SHOW_THUMBNAILS_SLIDER_ID, false);
	},
	
	enable: function(version) {
		global.log("Enable Multi Monitors Add-On ("+version+")...")
		
		if(Main.panel.statusArea.MultiMonitorsAddOn)
			disable();
		
		this._mmMonitors = 0;

		this._switchOffThumbnailsOvId = this._ov_settings.connect('changed::'+WORKSPACES_ONLY_ON_PRIMARY_ID,
																	Lang.bind(this, this._switchOffThumbnails));
		this._switchOffThumbnailsMuId = this._mu_settings.connect('changed::'+WORKSPACES_ONLY_ON_PRIMARY_ID,
				Lang.bind(this, this._switchOffThumbnails));

		this._showIndicatorId = this._settings.connect('changed::'+SHOW_INDICATOR_ID, Lang.bind(this, this._showIndicator));
		this._showIndicator();
		
		Main.mmLayoutManager = new MMLayout.MultiMonitorsLayoutManager();
		this._showPanelId = this._settings.connect('changed::'+MMLayout.SHOW_PANEL_ID, Lang.bind(Main.mmLayoutManager, Main.mmLayoutManager.showPanel));
		Main.mmLayoutManager.showPanel();
		
		this._showThumbnailsSliderId = this._settings.connect('changed::'+SHOW_THUMBNAILS_SLIDER_ID, Lang.bind(this, this._showThumbnailsSlider));
		this._relayoutId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._relayout));
		this._relayout();
	},
	
	disable: function() {
		Main.layoutManager.disconnect(this._relayoutId);
		this._ov_settings.disconnect(this._switchOffThumbnailsOvId);
		this._mu_settings.disconnect(this._switchOffThumbnailsMuId);
		
		this._settings.disconnect(this._showPanelId);
		this._settings.disconnect(this._showThumbnailsSliderId);
		this._settings.disconnect(this._showIndicatorId);

		
		this._hideIndicator();
		
		Main.mmLayoutManager.hidePanel();
		Main.mmLayoutManager = null;
		
		this._hideThumbnailsSlider();
		this._mmMonitors = 0;
		
		global.log("Disable Multi Monitors Add-On ...")
	}
});

let multiMonitorsAddOn = null;
let version = null;

function init(extensionMeta) {
	Convenience.initTranslations();
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(extensionMeta.path + "/icons");
    
//    for gnome-shell<3.26
    if (!Math.trunc) {
    	Math.trunc = function(v) {
    		v = +v;
    		return (v - v % 1)   ||   (!isFinite(v) || v === 0 ? v : v < 0 ? -0 : 0);
    	};
    }
    
    // fix bug in panel: Destroy function many time added to this same indicator.
    Main.panel._ensureIndicator = function(role) {
        let indicator = this.statusArea[role];
        if (indicator) {
            indicator.container.show();
            return null;
        }
        else {
            let constructor = PANEL_ITEM_IMPLEMENTATIONS[role];
            if (!constructor) {
                // This icon is not implemented (this is a bug)
                return null;
            }
            indicator = new constructor(this);
            this.statusArea[role] = indicator;
        }
        return indicator;
    };
    
    let metaVersion = MultiMonitors.metadata['version'];
    if (Number.isFinite(metaVersion)) {
    	version = 'v'+Math.trunc(metaVersion);
    	switch(Math.round((metaVersion%1)*10)) {
    		case 0:
    	    	break;
    		case 1:
    	    	version += '+bugfix';
    	    	break;
    		case 2:
    	    	version += '+develop';
    	    	break;
    		default:
    	    	version += '+modified';
    	    	break;
    	}
    }
    else
    	version = metaVersion;
}

function enable() {
	if (multiMonitorsAddOn !== null)
		return;
	
	multiMonitorsAddOn = new MultiMonitorsAddOn();
	multiMonitorsAddOn.enable(version);
}

function disable() {
	if (multiMonitorsAddOn == null)
		return;
	
	multiMonitorsAddOn.disable();
	multiMonitorsAddOn = null;
}
