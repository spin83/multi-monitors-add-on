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

const Util = imports.misc.util;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Gettext = imports.gettext.domain('multi-monitors-add-on');
const _ = Gettext.gettext;
const Convenience = imports.misc.extensionUtils.getCurrentExtension().imports.convenience;

const MultiMonitorsStatusIcon = new Lang.Class({
	Name: 'MultiMonitorsStatusIcon',
	Extends: St.BoxLayout,
	
	_init: function() {
		this.parent({ style_class: 'multimonitor-status-indicators-box' });
		Convenience.initTranslations("multi-monitors-add-on");		

		this._leftRightIcon = true;
		this._viewMonitorsId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._viewMonitors));
		this.connect('destroy', Lang.bind(this, this._onDestroy));

		this._viewMonitors();
	},
	
	_onDestroy: function(actor) {
		Main.layoutManager.disconnect(this._viewMonitorsId);
	},
	
	_syncIndicatorsVisible: function() {
        this.visible = this.get_children().some(function(actor) {
            return actor.visible;
        });
    },
	
	_viewMonitors: function() {
		let monitors = this.get_children();
	
		let monitorChange = Main.layoutManager.monitors.length - monitors.length;
		if(monitorChange>0){
			global.log("Add Monitors ...");
			for(let idx = 0; idx<monitorChange; idx++){
				let icon;
				if(this._leftRightIcon){
					icon = new St.Icon({
						icon_name: 'multi-monitors-l-symbolic',
						style_class: 'multimonitor-status-icon'
					});
				}
				else{
					icon = new St.Icon({
						icon_name: 'multi-monitors-r-symbolic',
						style_class: 'multimonitor-status-icon'
					});
				}
				
				this.add_child(icon);
				icon.connect('notify::visible', Lang.bind(this, this._syncIndicatorsVisible));
				this._leftRightIcon = !this._leftRightIcon;
			}
			this._syncIndicatorsVisible();
		}
		else if(monitorChange<0){
			global.log("Remove Monitors ...");
			monitorChange = -monitorChange;
			
			for(let idx = 0; idx<monitorChange; idx++){
				let icon = this.get_last_child();
				this.remove_child(icon);
				icon.destroy();
				this._leftRightIcon = !this._leftRightIcon;
			}
		}
	}
});

const MultiMonitorsIndicator = new Lang.Class({
	Name: 'MultiMonitorsIndicator',
	Extends: PanelMenu.Button,
	
	_init: function() {
		this.parent(0.0, "MultiMonitorsAddOn", false);
		
		this.text = null;

		this._mmStatusIcon = new MultiMonitorsStatusIcon();
		this.actor.add_child(this._mmStatusIcon);

		this.menu.addAction(_("Preferences"), Lang.bind(this, this._onPreferences));
		this.menu.addAction(_("Test"), Lang.bind(this, this._onTest));

	},
	
	_onPreferences: function()
	{
		Util.spawn(["gnome-shell-extension-prefs", "multi-monitors-add-on@spin83"]);
	},
	
	_onTest: function()
	{
		global.log('Multi Monitors Add-On');
		this._showHello();
	},
	
	_hideHello: function() {
	    Main.uiGroup.remove_actor(this.text);
	    this.text = null;
	},
	
	_showHello: function() {
	    if (!this.text) {
	        this.text = new St.Label({ style_class: 'helloworld-label', text: _("Multi Monitors Add-On") });
	        Main.uiGroup.add_actor(this.text);
	    }

	    this.text.opacity = 255;

	    let monitor = Main.layoutManager.primaryMonitor;

	    this.text.set_position(Math.floor(monitor.width / 2 - this.text.width / 2),
	                      Math.floor(monitor.height / 2 - this.text.height / 2));

	    Tweener.addTween(this.text,
	                     { opacity: 0,
	                       time: 4,
	                       transition: 'easeOutQuad',
	                       onComplete: Lang.bind(this, this._hideHello) });

	},
});
