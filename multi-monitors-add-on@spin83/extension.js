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

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const MMLayout = MultiMonitors.imports.mmlayout;
const MMOverview = MultiMonitors.imports.mmoverview;
const MMIndicator = MultiMonitors.imports.indicator;

const OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_THUMBNAILS_SLIDER_ID = 'show-thumbnails-slider';

const MultiMonitorsAddOn = new Lang.Class({
	Name: 'MultiMonitorsAddOn',
	
	_init: function() {
		this._settings = Convenience.getSettings();
		
		this._ov_settings = new Gio.Settings({ schema: OVERRIDE_SCHEMA });
		
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
			
			Main.mmOverview = [];
			for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
				let monitor = Main.layoutManager.monitors[i];
				if(i != Main.layoutManager.primaryIndex) {
					Main.mmOverview[i] = new MMOverview.MultiMonitorsOverview(i);
					Main.mmOverview[i].init();
				}
			}
			
			this.orginalSetWorkspacesFullGeometry = Main.overview.viewSelector._workspacesDisplay.setWorkspacesFullGeometry;
			
			Main.overview.viewSelector._workspacesDisplay.setWorkspacesFullGeometry = function(geom) {
		        this._fullGeometry = geom;
		        if (this._workspacesViews.length) {
		        	this._workspacesViews[this._primaryIndex].setFullGeometry(geom);
		        }
		    };
		    
		    this.orginal_updateWorkspacesFullGeometry = Main.overview.viewSelector._workspacesDisplay._updateWorkspacesFullGeometry;
		    Main.overview.viewSelector._workspacesDisplay._updateWorkspacesFullGeometry = function() {
		        if (!this._workspacesViews.length)
		            return;

		        let monitors = Main.layoutManager.monitors;
		        for (let i = 0; i < monitors.length; i++) {
		            let geometry = (i == this._primaryIndex) ? this._fullGeometry : Main.mmOverview[i].getWorkspacesGeometry();
		            this._workspacesViews[i].setFullGeometry(geometry);
		        }
		    };
		    
		    this.orginal_updateWorkspacesActualGeometry = Main.overview.viewSelector._workspacesDisplay._updateWorkspacesActualGeometry;
		    Main.overview.viewSelector._workspacesDisplay._updateWorkspacesActualGeometry = function() {
		        if (!this._workspacesViews.length)
		            return;

		        let [x, y] = this.actor.get_transformed_position();
		        let allocation = this.actor.allocation;
		        let width = allocation.x2 - allocation.x1;
		        let height = allocation.y2 - allocation.y1;
		        let primaryGeometry = { x: x, y: y, width: width, height: height };

		        let monitors = Main.layoutManager.monitors;
		        for (let i = 0; i < monitors.length; i++) {
		            let geometry = (i == this._primaryIndex) ? primaryGeometry : Main.mmOverview[i].getWorkspacesGeometry();
		            this._workspacesViews[i].setActualGeometry(geometry);
		        }
		    };
		    
		    this._notif_allocationId = Main.overview.viewSelector._workspacesDisplay.actor.connect('notify::allocation', Lang.bind(Main.overview.viewSelector._workspacesDisplay, Main.overview.viewSelector._workspacesDisplay._updateWorkspacesActualGeometry));
			
		}
		else{
			this._hideThumbnailsSlider();
		}
	},
	
	_hideThumbnailsSlider: function() {
		if(Main.mmOverview){
			Main.overview.viewSelector._workspacesDisplay.actor.disconnect(this._notif_allocationId);
			Main.overview.viewSelector._workspacesDisplay.setWorkspacesFullGeometry = this.orginalSetWorkspacesFullGeometry;
			this.orginalSetWorkspacesFullGeometry = null;
			Main.overview.viewSelector._workspacesDisplay._updateWorkspacesFullGeometry = this.orginal_updateWorkspacesFullGeometry;
			this.orginal_updateWorkspacesFullGeometry = null;
			Main.overview.viewSelector._workspacesDisplay._updateWorkspacesActualGeometry = this.orginal_updateWorkspacesActualGeometry;
			this.orginal_updateWorkspacesActualGeometry = null;
			
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
	},
	
	enable: function() {
		global.log("Enable Multi Monitors Add-On ...")
		
		if(Main.panel.statusArea.MultiMonitorsAddOn)
			disable();

		this._switchOffThumbnailsId = this._ov_settings.connect('changed::'+WORKSPACES_ONLY_ON_PRIMARY_ID,
																	Lang.bind(this, this._switchOffThumbnails));
		
		this._relayoutId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._relayout));
		Main.mmLayoutManager = new MMLayout.MultiMonitorsLayoutManager();
		
		this._showIndicator();

		this._showIndicatorId = this._settings.connect('changed::'+SHOW_INDICATOR_ID, Lang.bind(this, this._showIndicator));
		this._showPanelId = this._settings.connect('changed::'+MMLayout.SHOW_PANEL_ID, Lang.bind(Main.mmLayoutManager, Main.mmLayoutManager.showPanel));
		this._showThumbnailsSliderId = this._settings.connect('changed::'+SHOW_THUMBNAILS_SLIDER_ID, Lang.bind(this, this._showThumbnailsSlider));

		this._relayout();
		Main.mmLayoutManager.showPanel();

	},
	
	disable: function() {
		Main.layoutManager.disconnect(this._relayoutId);
		
		this._settings.disconnect(this._showPanelId);
		this._settings.disconnect(this._showThumbnailsSliderId);

		this._hideThumbnailsSlider();
		this._mmMonitors = 0;
		
		this._hideIndicator();
		
		Main.mmLayoutManager.hidePanel();
		Main.mmLayoutManager = null;
		
		this._ov_settings.disconnect(this._switchOffThumbnailsId);
		global.log("Disable Multi Monitors Add-On ...")
	}
});

function init(extensionMeta) {
	Convenience.initTranslations();
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(extensionMeta.path + "/icons");
	return new MultiMonitorsAddOn();
}
