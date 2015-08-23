/**
 * New node file
 */

const Lang = imports.lang;

const St = imports.gi.St;

const Main = imports.ui.main;
const Panel = imports.ui.panel;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const MMPanel = MultiMonitors.imports.mmpanel;

const SHOW_PANEL_ID = 'show-panel';

const MultiMonitorsLayoutManager = new Lang.Class({
	Name: 'MultiMonitorsLayoutManager',
	_init: function () {
	
		this._settings = Convenience.getSettings();
	
		Main.mmPanel = [];
	
		this._monitorIds = [];
		this.panelBox = [];
		this.mmappMenu = false;
		
		this._showAppMenuId = null;
		this._monitorsChangedId = null;
		
		this.statusIndicatorsController = null;
	},
	
	showPanel: function() {
		if (this._settings.get_boolean(SHOW_PANEL_ID)) {
			if (!this._monitorsChangedId) {
				this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._monitorsChanged));
				this._monitorsChanged();
			}
			if (!this._showAppMenuId) {
				this._showAppMenuId = this._settings.connect('changed::'+MMPanel.SHOW_APP_MENU_ID, Lang.bind(this, this._showAppMenu));
			}
			
			if (!this.statusIndicatorsController) {
				this.statusIndicatorsController = new MMPanel.StatusIndicatorsController();
			}
		}
		else {
			this.hidePanel();
		}
	},
	
	hidePanel: function() {
		if (this.statusIndicatorsController) {
			this.statusIndicatorsController.destroy();
			this.statusIndicatorsController = null;
		}
		
		if (this._showAppMenuId) {
			this._settings.disconnect(this._showAppMenuId);
			this._showAppMenuId = null;
		}
		this._hideAppMenu();
		
		if (this._monitorsChangedId) {
			Main.layoutManager.disconnect(this._monitorsChangedId);
			this._monitorsChangedId = null;
		}
		
		for (let i = 0; i < this._monitorIds.length; i++) {
			let monitorId = this._monitorIds.pop();
			this._popPanel();
			global.log("remove: "+monitorId);
		}
	},
	
	_monitorsChanged: function () {
		let monitorChange = Main.layoutManager.monitors.length - this._monitorIds.length -1;
		if (monitorChange<0) {
			for (let idx = 0; idx<-monitorChange; idx++) {
				let monitorId = this._monitorIds.pop();
				this._popPanel();
				global.log("remove: "+monitorId);
			}
		}
		
		let j = 0;
		let tIndicators = false;
		for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
			if (i!=Main.layoutManager.primaryIndex) {
				let monitor = Main.layoutManager.monitors[i];
				let monitorId = "i"+i+"x"+monitor.x+"y"+monitor.y+"w"+monitor.width+"h"+monitor.height;
				if (monitorChange>0 && j==this._monitorIds.length) {
					this._monitorIds.push(monitorId);
					this._pushPanel(i, monitor);
					global.log("new: "+monitorId);
					tIndicators = true;
				}
				else if (this._monitorIds[j]>monitorId || this._monitorIds[j]<monitorId) {
					let oldMonitorId = this._monitorIds[j];
					this._monitorIds[j]=monitorId;
					this._updatePanel(j, monitor);
					global.log("update: "+oldMonitorId+">"+monitorId);
				}
				j++;
			}
		}
		this._showAppMenu();
		if (tIndicators && this.statusIndicatorsController) {
			this.statusIndicatorsController.transferIndicators();
		}
	},
	
	_pushPanel: function(i, monitor) {
		let panel = new MMPanel.MultiMonitorsPanel(i);
		let panelBox = new St.BoxLayout({ name: 'panelBox', vertical: true });
        Main.layoutManager.addChrome(panelBox, { affectsStruts: true, trackFullscreen: true });
        panelBox.set_position(monitor.x, monitor.y);
        panelBox.set_size(monitor.width, -1);
        Main.uiGroup.set_child_below_sibling(panelBox, Main.layoutManager.panelBox);
//			this.panelBox.connect('allocation-changed', Lang.bind(this, this._panelBoxChanged));
		panelBox.add(panel.actor);
		
		Main.mmPanel.push(panel);
		this.panelBox.push(panelBox);
	},
	
	_popPanel: function() {
		let panel = Main.mmPanel.pop();
		if (this.statusIndicatorsController) {
			this.statusIndicatorsController.transferBack(panel);
		}
		let panelBox = this.panelBox.pop();
		panelBox.destroy();
    },
    
    _updatePanel: function(j, monitor) {
	    this.panelBox[j].set_position(monitor.x, monitor.y);
	    this.panelBox[j].set_size(monitor.width, -1);
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
		
	_showAppMenu: function() {
		if (this._settings.get_boolean(MMPanel.SHOW_APP_MENU_ID) && Main.mmPanel.length>0) {
			if (!this.mmappMenu) {
				this._changeMainPanelAppMenuButton(MMPanel.MultiMonitorsAppMenuButton);
				this.mmappMenu = true;
			}
		}
		else {
			this._hideAppMenu();
		}
	},
	
	_hideAppMenu: function() {
		if (this.mmappMenu) {
			this._changeMainPanelAppMenuButton(Panel.AppMenuButton);
			this.mmappMenu = false;
		}		
	},
});
    