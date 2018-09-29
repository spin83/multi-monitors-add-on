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

const Gettext = imports.gettext.domain('multi-monitors-add-on');
const _ = Gettext.gettext;
const Convenience = imports.misc.extensionUtils.getCurrentExtension().imports.convenience;

var MultiMonitorsIndicator = new Lang.Class({
	Name: 'MultiMonitorsIndicator',
	Extends: PanelMenu.Button,
	
	_init() {
		this.parent(0.0, "MultiMonitorsAddOn", false);
		
		Convenience.initTranslations();
		
		this.text = null;

		this._mmStatusIcon = new St.BoxLayout({ style_class: 'multimonitor-status-indicators-box' });
		this._mmStatusIcon.hide();
		this.actor.add_child(this._mmStatusIcon);
		this._leftRightIcon = true;

		this.menu.addAction(_("Preferences"), this._onPreferences.bind(this));
		
		this._viewMonitorsId = Main.layoutManager.connect('monitors-changed', this._viewMonitors.bind(this));
		this.connect('destroy', this._onDestroy.bind(this));
		this._viewMonitors();
	},	
		
	_onDestroy(actor) {
		Main.layoutManager.disconnect(this._viewMonitorsId);
	},
	
	_syncIndicatorsVisible() {
        this._mmStatusIcon.visible = this._mmStatusIcon.get_children().some((actor) => {
            return actor.visible;
        });
    },
	
	_viewMonitors() {
		let monitors = this._mmStatusIcon.get_children();
	
		let monitorChange = Main.layoutManager.monitors.length - monitors.length;
		if(monitorChange>0){
			global.log("Add Monitors ...");
			for(let idx = 0; idx<monitorChange; idx++){
				let icon;
				icon = new St.Icon({style_class: 'system-status-icon multimonitor-status-icon'});
				this._mmStatusIcon.add_child(icon);
				icon.connect('notify::visible', this._syncIndicatorsVisible.bind(this));
				
				if(this._leftRightIcon)
					icon.icon_name = 'multi-monitors-l-symbolic';
				else
					icon.icon_name = 'multi-monitors-r-symbolic';
				this._leftRightIcon = !this._leftRightIcon;
			}
			this._syncIndicatorsVisible();
		}
		else if(monitorChange<0){
			global.log("Remove Monitors ...");
			monitorChange = -monitorChange;
			
			for(let idx = 0; idx<monitorChange; idx++){
				let icon = this._mmStatusIcon.get_last_child();
				this._mmStatusIcon.remove_child(icon);
				icon.destroy();
				this._leftRightIcon = !this._leftRightIcon;
			}
		}
	},
	
	_onPreferences()
	{
		Util.spawn(["gnome-shell-extension-prefs", "multi-monitors-add-on@spin83"]);
	},
	
	_onInit2ndMonitor()
	{
		Util.spawn(["intel-virtual-output"]);
	},
	
	_hideHello() {
	    Main.uiGroup.remove_actor(this.text);
	    this.text = null;
	},
	
	_showHello() {
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
	                       onComplete: this._hideHello.bind(this) });

	},
});
