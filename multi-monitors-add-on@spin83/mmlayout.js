/**
 * New node file
 */

const { St, Meta } = imports.gi;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const Layout = imports.ui.layout;

const Config = imports.misc.config;

const ExtensionUtils = imports.misc.extensionUtils;
const CE = ExtensionUtils.getCurrentExtension();
const Convenience = CE.imports.convenience;
const MultiMonitors = CE.imports.extension;
const MMPanel = CE.imports.mmpanel;

var SHOW_PANEL_ID = 'show-panel';

const MultiMonitorsPanelBox = class MultiMonitorsPanelBox {
	constructor(monitor) {
		this._rightPanelBarrier = null;
	
		this.panelBox = new St.BoxLayout({ name: 'panelBox', vertical: true });
        Main.layoutManager.addChrome(this.panelBox, { affectsStruts: true, trackFullscreen: true });
        this.panelBox.set_position(monitor.x, monitor.y);
        this.panelBox.set_size(monitor.width, -1);
        Main.uiGroup.set_child_below_sibling(this.panelBox, Main.layoutManager.panelBox);
        
		this._panelBoxChangedId = this.panelBox.connect('allocation-changed', this._panelBoxChanged.bind(this));
	}
	
	destroy() {
		if (this._rightPanelBarrier) {
	        this._rightPanelBarrier.destroy();
	        this._rightPanelBarrier = null;
	    }
	
		this.panelBox.disconnect(this._panelBoxChangedId);
		this.panelBox.destroy();
	}
	
	updatePanel(monitor) {
	    this.panelBox.set_position(monitor.x, monitor.y);
	    this.panelBox.set_size(monitor.width, -1);
	}

	_panelBoxChanged(self, box, flags) {
//		global.log(box.get_x()+" "+box.get_y()+" "+box.get_height()+" "+box.get_width())
		
	    if (this._rightPanelBarrier) {
	        this._rightPanelBarrier.destroy();
	        this._rightPanelBarrier = null;
	    }
	    
	    if (this.panelBox.height) {
	    	this._rightPanelBarrier = new Meta.Barrier({ display: global.display,
	    									x1: box.get_x() + box.get_width(), y1: box.get_y(),
								            x2: box.get_x() + box.get_width(), y2: box.get_y() + this.panelBox.height,
								            directions: Meta.BarrierDirection.NEGATIVE_X });
	    }
	}
};

var MultiMonitorsLayoutManager = class MultiMonitorsLayoutManager {
	constructor() {
		this._settings = Convenience.getSettings();
		this._desktopSettings = Convenience.getSettings("org.gnome.desktop.interface");

		Main.mmPanel = [];
	
		this._monitorIds = [];
		this.mmPanelBox = [];
		this.mmappMenu = false;
		
		this._showAppMenuId = null;
		this._monitorsChangedId = null;
		
		this.statusIndicatorsController = null;
		this._layoutManager_updateHotCorners = null;
		this._changedEnableHotCornersId = null;
	}
	
	showPanel() {
		if (this._settings.get_boolean(SHOW_PANEL_ID)) {
			if (!this._monitorsChangedId) {
				this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._monitorsChanged.bind(this));
				this._monitorsChanged();
			}
			if (!this._showAppMenuId) {
				this._showAppMenuId = this._settings.connect('changed::'+MMPanel.SHOW_APP_MENU_ID, this._showAppMenu.bind(this));
			}
			
			if (!this.statusIndicatorsController) {
				this.statusIndicatorsController = new MMPanel.StatusIndicatorsController();
			}
			
			if (!this._layoutManager_updateHotCorners) {
				this._layoutManager_updateHotCorners = Main.layoutManager._updateHotCorners;
				
				let enable_hot_corners = (Main.sessionMode.currentMode == 'ubuntu');
				let that = this;
				Main.layoutManager._updateHotCorners = function() {
			        this.hotCorners.forEach((corner) => {
			            if (corner)
			                corner.destroy();
			        });
			        this.hotCorners = [];
			        
			        if (enable_hot_corners) {
								try {
									if (!global.settings.get_boolean('enable-hot-corners')) {
											this.emit('hot-corners-changed');
											return;
									}
								} catch (e) {
									if (!that._desktopSettings.get_boolean('enable-hot-corners')) {
										this.emit('hot-corners-changed');
										return;
									}
								}
			        }
			        
			        let size = this.panelBox.height;

			        for (let i = 0; i < this.monitors.length; i++) {
			            let monitor = this.monitors[i];
			            let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
			            let cornerY = monitor.y;
	
		                let corner = new Layout.HotCorner(this, monitor, cornerX, cornerY);
		                corner.setBarrierSize(size);
		                this.hotCorners.push(corner);
			        }

			        this.emit('hot-corners-changed');
				};
				
				if (!this._changedEnableHotCornersId) {
					if (enable_hot_corners) {
						try {
							this._changedEnableHotCornersId = global.settings.connect('changed::enable-hot-corners',
									Main.layoutManager._updateHotCorners.bind(Main.layoutManager));
						} catch (e) {
							this._changedEnableHotCornersId = this._desktopSettings.connect('changed::enable-hot-corners',
									Main.layoutManager._updateHotCorners.bind(Main.layoutManager));
						}
					}
				}
				
				Main.layoutManager._updateHotCorners();
			}
		}
		else {
			this.hidePanel();
		}
	}
	
	hidePanel() {
		if (this._changedEnableHotCornersId) {
			global.settings.disconnect(this._changedEnableHotCornersId);
			this._changedEnableHotCornersId = null;
		}
		
		if (this._layoutManager_updateHotCorners) {
			Main.layoutManager['_updateHotCorners'] = this._layoutManager_updateHotCorners;
			this._layoutManager_updateHotCorners = null;
			Main.layoutManager._updateHotCorners();
		}
			
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

		let panels2remove = this._monitorIds.length;
		for (let i = 0; i < panels2remove; i++) {
			let monitorId = this._monitorIds.pop();
			this._popPanel();
			global.log("remove: "+monitorId);
		}
	}
	
	_monitorsChanged () {
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
					this.mmPanelBox[j].updatePanel(monitor);
					global.log("update: "+oldMonitorId+">"+monitorId);
				}
				j++;
			}
		}
		this._showAppMenu();
		if (tIndicators && this.statusIndicatorsController) {
			this.statusIndicatorsController.transferIndicators();
		}
	}
	
	_pushPanel(i, monitor) {
		let mmPanelBox = new MultiMonitorsPanelBox(monitor);
		let panel = new MMPanel.MultiMonitorsPanel(i, mmPanelBox);
		
		Main.mmPanel.push(panel);
		this.mmPanelBox.push(mmPanelBox);
	}
	
	_popPanel() {
		let panel = Main.mmPanel.pop();
		if (this.statusIndicatorsController) {
			this.statusIndicatorsController.transferBack(panel);
		}
		let mmPanelBox = this.mmPanelBox.pop();
		mmPanelBox.destroy();
    }
    	
	_changeMainPanelAppMenuButton(appMenuButton) {
		let role = "appMenu";
		let panel = Main.panel;
		let indicator = panel.statusArea[role];
		panel.menuManager.removeMenu(indicator.menu);
		indicator.destroy();
		if (indicator._actionGroupNotifyId) {
			indicator._targetApp.disconnect(indicator._actionGroupNotifyId);
			indicator._actionGroupNotifyId = 0;
        }
        if (indicator._busyNotifyId) {
        	indicator._targetApp.disconnect(indicator._busyNotifyId);
        	indicator._busyNotifyId = 0;
        }
        if (indicator.menu._windowsChangedId) {
        	indicator.menu._app.disconnect(indicator.menu._windowsChangedId);
        	indicator.menu._windowsChangedId = 0;
        }
		indicator = new appMenuButton(panel);
		panel.statusArea[role] = indicator;
		let box = panel._leftBox;
		panel._addToPanelBox(role, indicator, box.get_n_children()+1, box);
	}
		
	_showAppMenu() {
		if (this._settings.get_boolean(MMPanel.SHOW_APP_MENU_ID) && Main.mmPanel.length>0) {
			if (!this.mmappMenu) {
				this._changeMainPanelAppMenuButton(MMPanel.MultiMonitorsAppMenuButton);
				this.mmappMenu = true;
			}
		}
		else {
			this._hideAppMenu();
		}
	}
	
	_hideAppMenu() {
		if (this.mmappMenu) {
			this._changeMainPanelAppMenuButton(Panel.AppMenuButton);
			this.mmappMenu = false;
			Main.panel._updatePanel()
		}		
	}
};
