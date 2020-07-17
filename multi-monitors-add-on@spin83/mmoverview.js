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

const { Clutter, GObject, St, Shell, Gio, Meta } = imports.gi;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Params = imports.misc.params;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const OverviewControls = imports.ui.overviewControls;
const Overview = imports.ui.overview;
const ViewSelector = imports.ui.viewSelector;
const LayoutManager = imports.ui.layout;
const Background = imports.ui.background;
const WorkspacesView = imports.ui.workspacesView;
let SwipeTracker = null;

const ExtensionUtils = imports.misc.extensionUtils;
const CE = ExtensionUtils.getCurrentExtension();
const MultiMonitors = CE.imports.extension;
const Convenience = CE.imports.convenience;

if (MultiMonitors.gnomeShellVersion()[1]>34) {
	SwipeTracker = imports.ui.swipeTracker;
}

const THUMBNAILS_ON_LEFT_SIDE_ID = 'thumbnails-on-left-side';

var MultiMonitorsWorkspaceThumbnail = (() => {
	let MultiMonitorsWorkspaceThumbnail = class MultiMonitorsWorkspaceThumbnail extends St.Widget {
	    _init (metaWorkspace, monitorIndex) {

        this.metaWorkspace = metaWorkspace;
        this.monitorIndex = monitorIndex;

		if (MultiMonitors.gnomeShellVersion()[1]==32) {
				this.actor = this;
		}

        super._init({
            clip_to_allocation: true,
            style_class: 'workspace-thumbnail'
        });
        this._delegate = this;

        this._contents = new Clutter.Actor();
        this.add_child(this._contents);

        this.connect('destroy', this._onDestroy.bind(this));

//        this._createBackground();
        this._bgManager = new Background.BackgroundManager({ monitorIndex: this.monitorIndex,
														        container: this._contents,
														        vignette: false });

        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitorIndex);
        this.setPorthole(workArea.x, workArea.y, workArea.width, workArea.height);

        let windows = global.get_window_actors().filter(actor => {
            let win = actor.meta_window;
            return win.located_on_workspace(metaWorkspace);
        });

        // Create clones for windows that should be visible in the Overview
        this._windows = [];
        //--- fix Ubuntu changes from js-fix-invalid-access-errors.patch
        this._windowsDestroyedIds = [];
        //---
        this._allWindows = [];
        this._minimizedChangedIds = [];
        for (let i = 0; i < windows.length; i++) {
            let minimizedChangedId =
                windows[i].meta_window.connect('notify::minimized', this._updateMinimized.bind(this));
            this._allWindows.push(windows[i].meta_window);
            this._minimizedChangedIds.push(minimizedChangedId);

            if (this._isMyWindow(windows[i]) && this._isOverviewWindow(windows[i])) {
                this._addWindowClone(windows[i]);
            }
        }

        // Track window changes
        this._windowAddedId = this.metaWorkspace.connect('window-added',
        		this._windowAdded.bind(this));
		this._windowRemovedId = this.metaWorkspace.connect('window-removed',
				this._windowRemoved.bind(this));
		this._windowEnteredMonitorId = global.display.connect('window-entered-monitor',
				this._windowEnteredMonitor.bind(this));
		this._windowLeftMonitorId = global.display.connect('window-left-monitor',
				this._windowLeftMonitor.bind(this));

        this.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
        this._slidePosition = 0; // Fully slid in
        this._collapseFraction = 0; // Not collapsed
    }

   	//for Gnome 3.32 version compatibility.    
    destroy() {
    	if (MultiMonitors.gnomeShellVersion()[1]==32) {
    		this.workspaceRemoved();
    		if (this.actor) {
    			Tweener.removeTweens(this.actor);
    			super.destroy();
    		}
		}
		else {
			super.destroy();
		}
    }
};
	MultiMonitors.copyClass(WorkspaceThumbnail.WorkspaceThumbnail, MultiMonitorsWorkspaceThumbnail);
	return GObject.registerClass({
	    Properties: {
	        'collapse-fraction': GObject.ParamSpec.double(
	            'collapse-fraction', 'collapse-fraction', 'collapse-fraction',
	            GObject.ParamFlags.READWRITE,
	            0, 1, 0),
	        'slide-position': GObject.ParamSpec.double(
	            'slide-position', 'slide-position', 'slide-position',
	            GObject.ParamFlags.READWRITE,
	            0, 1, 0),
	    }}, MultiMonitorsWorkspaceThumbnail);
})();

const MultiMonitorsThumbnailsBox = (() => {
	let MultiMonitorsThumbnailsBox = class MultiMonitorsThumbnailsBox extends St.Widget {
	    _init(monitorIndex, scrollAdjustment) {
	    	this._monitorIndex = monitorIndex;
	    	
	  		if (MultiMonitors.gnomeShellVersion()[1]==32) {
				this.actor = this;
			}

	    	super._init({ reactive: true,
	                      style_class: 'workspace-thumbnails',
	                      request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT });
	
	        this._delegate = this;
	
	        let indicator = new St.Bin({ style_class: 'workspace-thumbnail-indicator' });
	
	        // We don't want the indicator to affect drag-and-drop
	        Shell.util_set_hidden_from_pick(indicator, true);
	
	        this._indicator = indicator;
	        this.add_actor(indicator);
	
	        // The porthole is the part of the screen we're showing in the thumbnails
	        this._porthole = { width: global.stage.width, height: global.stage.height,
	                           x: global.stage.x, y: global.stage.y };
	
	        this._dropWorkspace = -1;
	        this._dropPlaceholderPos = -1;
	        this._dropPlaceholder = new St.Bin({ style_class: 'placeholder' });
	        this.add_actor(this._dropPlaceholder);
	        this._spliceIndex = -1;
	
	        this._targetScale = 0;
	        this._scale = 0;
	        this._pendingScaleUpdate = false;
	        this._stateUpdateQueued = false;
	        this._animatingIndicator = false;
	        this._indicatorY = 0; // only used when _animatingIndicator is true
	
	        this._stateCounts = {};
	        for (let key in WorkspaceThumbnail.ThumbnailState)
	            this._stateCounts[WorkspaceThumbnail.ThumbnailState[key]] = 0;
	
	        this._thumbnails = [];
	
			if (MultiMonitors.gnomeShellVersion()[1]<36) {
	        	this.connect('button-press-event', () => Clutter.EVENT_STOP);
	        	this.connect('button-release-event', this._onButtonRelease.bind(this));
	        	this.connect('touch-event', this._onTouchEvent.bind(this));
			}
	
	        this._showingId = Main.overview.connect('showing',
	                              this._createThumbnails.bind(this));
	        this._hiddenId = Main.overview.connect('hidden',
	                              this._destroyThumbnails.bind(this));
	
	        this._itemDragBeginId = Main.overview.connect('item-drag-begin',
	                              this._onDragBegin.bind(this));
	        this._itemDragEndId = Main.overview.connect('item-drag-end',
	                              this._onDragEnd.bind(this));
	        this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled',
	                              this._onDragCancelled.bind(this));
	        this._windowDragBeginId = Main.overview.connect('window-drag-begin',
	                              this._onDragBegin.bind(this));
	        this._windowDragEndId = Main.overview.connect('window-drag-end',
	                              this._onDragEnd.bind(this));
	        this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled',
	                              this._onDragCancelled.bind(this));
	
	        this._settings = new Gio.Settings({ schema_id: WorkspaceThumbnail.MUTTER_SCHEMA });
	        this._changedDynamicWorkspacesId = this._settings.connect('changed::dynamic-workspaces',
	            this._updateSwitcherVisibility.bind(this));
	
	        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
	            this._destroyThumbnails();
	            if (Main.overview.visible)
	                this._createThumbnails();
	        });
	
	        this._workareasChangedPortholeId = global.display.connect('workareas-changed',
	                               this._updatePorthole.bind(this));
	
	        this._switchWorkspaceNotifyId = 0;
	        this._syncStackingId = 0;
	        this._workareasChangedId = 0;

			if (MultiMonitors.gnomeShellVersion()[1]>=36)
			{
		        this._scrollAdjustment = scrollAdjustment;
		
		        this._scrollAdjustmentNotifyValueId = this._scrollAdjustment.connect('notify::value', adj => {
		            let workspaceManager = global.workspace_manager;
		            let activeIndex = workspaceManager.get_active_workspace_index();
		
		            this._animatingIndicator = adj.value !== activeIndex;
		
		            if (!this._animatingIndicator)
		                this._queueUpdateStates();
		
		            this.queue_relayout();
		        });
			}
	        
	        this.connect('destroy', this._onDestroy.bind(this));
	    }
	
	    _onDestroy() {
	        this._destroyThumbnails();
			if (MultiMonitors.gnomeShellVersion()[1]>=36)
				this._scrollAdjustment.disconnect(this._scrollAdjustmentNotifyValueId);
	
			Main.overview.disconnect(this._showingId);
			Main.overview.disconnect(this._hiddenId);
			
			Main.overview.disconnect(this._itemDragBeginId);
			Main.overview.disconnect(this._itemDragEndId);
			Main.overview.disconnect(this._itemDragCancelledId);
			Main.overview.disconnect(this._windowDragBeginId);
			Main.overview.disconnect(this._windowDragEndId);
			Main.overview.disconnect(this._windowDragCancelledId);
	
	        this._settings.disconnect(this._changedDynamicWorkspacesId);
        	Main.layoutManager.disconnect(this._monitorsChangedId);
	        global.display.disconnect(this._workareasChangedPortholeId);
	    }
	
	    addThumbnails(start, count) {
	        let workspaceManager = global.workspace_manager;
	
	        for (let k = start; k < start + count; k++) {
	            let metaWorkspace = workspaceManager.get_workspace_by_index(k);
	            let thumbnail = new MultiMonitorsWorkspaceThumbnail(metaWorkspace, this._monitorIndex);
	            thumbnail.setPorthole(this._porthole.x, this._porthole.y,
	                                  this._porthole.width, this._porthole.height);
	            this._thumbnails.push(thumbnail);
            	this.add_actor(thumbnail);
	
	            if (start > 0 && this._spliceIndex == -1) {
	                // not the initial fill, and not splicing via DND
	                thumbnail.state = WorkspaceThumbnail.ThumbnailState.NEW;
	          		if (MultiMonitors.gnomeShellVersion()[1]==32) {
						thumbnail.slidePosition = 1; // start slid out
					}
	                else {
	                	thumbnail.slide_position = 1; // start slid out
	                }
	                this._haveNewThumbnails = true;
	            } else {
	                thumbnail.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
	            }
	
	            this._stateCounts[thumbnail.state]++;
	        }
	
	        this._queueUpdateStates();
	
	        // The thumbnails indicator actually needs to be on top of the thumbnails
			if (MultiMonitors.gnomeShellVersion()[1]<36)
	        	this._indicator.raise_top();
			else
				this.set_child_above_sibling(this._indicator, null);
	
	        // Clear the splice index, we got the message
	        this._spliceIndex = -1;
	    }
	    
	    _updatePorthole() {
	        this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
	        this.queue_relayout();
	    }
	};
	MultiMonitors.copyClass(WorkspaceThumbnail.ThumbnailsBox, MultiMonitorsThumbnailsBox);
	return GObject.registerClass({
	    Properties: {
	        'indicator-y': GObject.ParamSpec.double(
	            'indicator-y', 'indicator-y', 'indicator-y',
	            GObject.ParamFlags.READWRITE,
	            0, Infinity, 0),
	        'scale': GObject.ParamSpec.double(
	            'scale', 'scale', 'scale',
	            GObject.ParamFlags.READWRITE,
	            0, Infinity, 0)
	    }}, MultiMonitorsThumbnailsBox);
})();

var MultiMonitorsSlidingControl = (() => {
	let MultiMonitorsSlidingControl = class MultiMonitorsSlidingControl extends St.Widget {
	    _init(params) {
	        params = Params.parse(params, { slideDirection: OverviewControls.SlideDirection.LEFT });
	
	        this.layout = new OverviewControls.SlideLayout();
	        this.layout.slideDirection = params.slideDirection;
	        super._init({
	            layout_manager: this.layout,
	            style_class: 'overview-controls',
	            clip_to_allocation: true,
	        });
	
	        this._visible = true;
	        this._inDrag = false;

			this.connect('destroy', this._onDestroy.bind(this));
	
	        this._hidingId = Main.overview.connect('hiding', this._onOverviewHiding.bind(this));
	
	        this._itemDragBeginId = Main.overview.connect('item-drag-begin', this._onDragBegin.bind(this));
	        this._itemDragEndId = Main.overview.connect('item-drag-end', this._onDragEnd.bind(this));
	        this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled', this._onDragEnd.bind(this));
	
	        this._windowDragBeginId = Main.overview.connect('window-drag-begin', this._onWindowDragBegin.bind(this));
	        this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled', this._onWindowDragEnd.bind(this));
	        this._windowDragEndId = Main.overview.connect('window-drag-end', this._onWindowDragEnd.bind(this));
	    }
	    
	    _onDestroy() {
	    	Main.overview.disconnect(this._hidingId);
		    
	    	Main.overview.disconnect(this._itemDragBeginId);
	    	Main.overview.disconnect(this._itemDragEndId);
	    	Main.overview.disconnect(this._itemDragCancelledId);
	
	    	Main.overview.disconnect(this._windowDragBeginId);
	    	Main.overview.disconnect(this._windowDragCancelledId);
	    	Main.overview.disconnect(this._windowDragEndId);
	    }
	};
	MultiMonitors.copyClass(OverviewControls.SlidingControl, MultiMonitorsSlidingControl);
	return GObject.registerClass(MultiMonitorsSlidingControl);
})();

const MultiMonitorsSlidingControl34 = class MultiMonitorsSlidingControl34 {
    constructor (params) {
        params = Params.parse(params, { slideDirection: OverviewControls.SlideDirection.LEFT });

        this._visible = true;
        this._inDrag = false;

        this.layout = new OverviewControls.SlideLayout();
        this.layout.slideDirection = params.slideDirection;
        this.layout.translationX = 0;
        this.actor = new St.Widget({ layout_manager: this.layout,
                                     style_class: 'overview-controls',
                                     clip_to_allocation: true });

        this.actor.connect('destroy', this._onDestroy.bind(this));
        
        this._hidingId = Main.overview.connect('hiding', this._onOverviewHiding.bind(this));

        this._itemDragBeginId = Main.overview.connect('item-drag-begin', this._onDragBegin.bind(this));
        this._itemDragEndId = Main.overview.connect('item-drag-end', this._onDragEnd.bind(this));
        this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled', this._onDragEnd.bind(this));

        this._windowDragBeginId = Main.overview.connect('window-drag-begin', this._onWindowDragBegin.bind(this));
        this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled', this._onWindowDragEnd.bind(this));
        this._windowDragEndId = Main.overview.connect('window-drag-end', this._onWindowDragEnd.bind(this));
        
        this.onAnimationBegin = null;
        this.onAnimationEnd = null;
    }
    
    _onDestroy() {
    	Main.overview.disconnect(this._hidingId);
	    
    	Main.overview.disconnect(this._itemDragBeginId);
    	Main.overview.disconnect(this._itemDragEndId);
    	Main.overview.disconnect(this._itemDragCancelledId);

    	Main.overview.disconnect(this._windowDragBeginId);
    	Main.overview.disconnect(this._windowDragCancelledId);
    	Main.overview.disconnect(this._windowDragEndId);
    }
};
MultiMonitors.copyClass(OverviewControls.SlidingControl, MultiMonitorsSlidingControl34);

var MultiMonitorsThumbnailsSlider = (() => {
	let MultiMonitorsThumbnailsSlider = class MultiMonitorsThumbnailsSlider extends MultiMonitorsSlidingControl {
	    _init(thumbnailsBox) {
	        super._init({ slideDirection: OverviewControls.SlideDirection.RIGHT });
	
	        this._thumbnailsBox = thumbnailsBox;
	
	        this.request_mode = Clutter.RequestMode.WIDTH_FOR_HEIGHT;
	        this.reactive = true;
	        this.track_hover = true;
	        this.add_actor(this._thumbnailsBox);
	
	        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._updateSlide.bind(this));
	        this._activeWorkspaceChangedId = global.workspace_manager.connect('active-workspace-changed',
	                                         this._updateSlide.bind(this));
	        this._notifyNWorkspacesId = global.workspace_manager.connect('notify::n-workspaces',
	                                         this._updateSlide.bind(this));
	        this.connect('notify::hover', this._updateSlide.bind(this));
	        this._thumbnailsBox.bind_property('visible', this, 'visible', GObject.BindingFlags.SYNC_CREATE);
	    }
	    
	    _onDestroy() {
	    	global.workspace_manager.disconnect(this._activeWorkspaceChangedId);
	    	global.workspace_manager.disconnect(this._notifyNWorkspacesId);
	    	Main.layoutManager.disconnect(this._monitorsChangedId);
	    	super._onDestroy();
		}
	};
	MultiMonitors.copyClass(OverviewControls.ThumbnailsSlider, MultiMonitorsThumbnailsSlider);
	return GObject.registerClass(MultiMonitorsThumbnailsSlider);
})();

const MultiMonitorsThumbnailsSlider34 = class MultiMonitorsThumbnailsSlider34 extends MultiMonitorsSlidingControl34 {
    constructor(thumbnailsBox) {
        super({ slideDirection: OverviewControls.SlideDirection.RIGHT });

        this._thumbnailsBox = thumbnailsBox;

        this.actor.request_mode = Clutter.RequestMode.WIDTH_FOR_HEIGHT;
        this.actor.reactive = true;
        this.actor.track_hover = true;
        this.actor.add_actor(this._thumbnailsBox);

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._updateSlide.bind(this));
        this._activeWorkspaceChangedId = global.workspace_manager.connect('active-workspace-changed',
                                         this._updateSlide.bind(this));
        this._notifyNWorkspacesId = global.workspace_manager.connect('notify::n-workspaces',
                                         this._updateSlide.bind(this));
        this.actor.connect('notify::hover', this._updateSlide.bind(this));
        this._thumbnailsBox.bind_property('visible', this.actor, 'visible', GObject.BindingFlags.SYNC_CREATE);
    }
    
    _onDestroy() {
    	global.workspace_manager.disconnect(this._activeWorkspaceChangedId);
    	global.workspace_manager.disconnect(this._notifyNWorkspacesId);
    	Main.layoutManager.disconnect(this._monitorsChangedId);
    	super._onDestroy();
	}
};
MultiMonitors.copyClass(OverviewControls.ThumbnailsSlider, MultiMonitorsThumbnailsSlider34);

const MultiMonitorsControlsManager = class MultiMonitorsControlsManager {
    constructor(index) {
    	this._monitorIndex = index;
    	this._workspacesViews = null;
    	
    	this._fullGeometry = null;
    	this._animationInProgress = false;

		if (MultiMonitors.gnomeShellVersion()[1]<36)
        	this._thumbnailsBox = new MultiMonitorsThumbnailsBox(this._monitorIndex, null);
		else {
	        let workspaceManager = global.workspace_manager;
	        let activeWorkspaceIndex = workspaceManager.get_active_workspace_index();
	
			this._workspaceAdjustment = Main.overview._overview._controls._workspaceAdjustment;
			this._thumbnailsBox = new MultiMonitorsThumbnailsBox(this._monitorIndex, this._workspaceAdjustment);
		}

		if (MultiMonitors.gnomeShellVersion()[1]<36)
        	this._thumbnailsSlider = new MultiMonitorsThumbnailsSlider34(this._thumbnailsBox);
		else
        	this._thumbnailsSlider = new MultiMonitorsThumbnailsSlider(this._thumbnailsBox);
        
        this._thumbnailsSlider.onAnimationBegin = () => {
        	this._animationInProgress = true;
        };
        this._thumbnailsSlider.onAnimationEnd = () => {
        	this._animationInProgress = false;
        	if(!this._workspacesViews)
        		return;
        	let geometry = this.getWorkspacesActualGeometry();
//        	global.log("actualG+ i: "+this._monitorIndex+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
        	this._workspacesViews.setActualGeometry(geometry);
		};

        let layout = new OverviewControls.ControlsLayout();
        this.actor = new St.Widget({ layout_manager: layout,
                                     x_expand: true, y_expand: true,
                                     clip_to_allocation: true });
        this.actor.connect('destroy', this._onDestroy.bind(this));
        
        
        this._group = new St.BoxLayout({ name: 'mm-overview-group',
                                        x_expand: true, y_expand: true });
        this.actor.add_actor(this._group);
        
		if (MultiMonitors.gnomeShellVersion()[1]<36) {
	        this._viewActor = new St.Widget({ clip_to_allocation: true });
	        this._group.add(this._viewActor, { x_fill: true,
	        									expand: true });
	        this._group.add_actor(this._thumbnailsSlider.actor);
		}
		else {
	        this._viewActor = new St.Widget({ x_expand: true, y_expand: true, clip_to_allocation: true });
			this._group.add_actor(this._viewActor);
	        this._group.add_actor(this._thumbnailsSlider);
		}

        layout.connect('allocation-changed', this._updateWorkspacesGeometry.bind(this));
        this.actor.connect('scroll-event', this._onScrollEvent.bind(this));
        
        this._settings = Convenience.getSettings();
        this._thumbnailsOnLeftSideId = this._settings.connect('changed::'+THUMBNAILS_ON_LEFT_SIDE_ID,
        													this._thumbnailsOnLeftSide.bind(this));
        this._thumbnailsOnLeftSide();
        
	    this._pageChangedId = Main.overview.viewSelector.connect('page-changed', this._setVisibility.bind(this));
	    this._pageEmptyId = Main.overview.viewSelector.connect('page-empty', this._onPageEmpty.bind(this));
	    
	    this._clickAction = new Clutter.ClickAction()
        this._clickedId = this._clickAction.connect('clicked', (action) => {
            if (action.get_button() == 1 && this._workspacesViews &&
            								this._workspacesViews.getActiveWorkspace().isEmpty())
                Main.overview.hide();
        });
	    
	    Main.mmOverview[this._monitorIndex].addAction(this._clickAction);
	    this._thumbnailsBox._updatePorthole()
    }
    
    inOverviewInit() {
	    if (Main.overview.visible) {
	    	this._thumbnailsBox._createThumbnails();
	        let activePage = Main.overview.viewSelector.getActivePage();
	        if (activePage != ViewSelector.ViewPage.WINDOWS) {
	        	this._thumbnailsSlider.slideOut();
	        	this._thumbnailsSlider.pageEmpty();
	        }
	    	this.show();
	    }	
    }

    /*_updateAdjustment() {
        let workspaceManager = global.workspace_manager;
        let newNumWorkspaces = workspaceManager.n_workspaces;
        let activeIndex = workspaceManager.get_active_workspace_index();

        this._workspaceAdjustment.upper = newNumWorkspaces;

        // A workspace might have been inserted or removed before the active
        // one, causing the adjustment to go out of sync, so update the value
        this._workspaceAdjustment.value = activeIndex;
    }*/
    
	_onScrollEvent(actor, event) {
		if (!this.actor.mapped)
			return Clutter.EVENT_PROPAGATE;
		let display;
		display = global.screen || global.workspace_manager;

		let activeWs = display.get_active_workspace();
		let ws;
		switch (event.get_scroll_direction()) {
		case Clutter.ScrollDirection.UP:
			ws = activeWs.get_neighbor(Meta.MotionDirection.UP);
			break;
		case Clutter.ScrollDirection.DOWN:
			ws = activeWs.get_neighbor(Meta.MotionDirection.DOWN);
			break;
		default:
			return Clutter.EVENT_PROPAGATE;
		}
		Main.wm.actionMoveWorkspace(ws);
		return Clutter.EVENT_STOP;
	}
	
    _onDestroy() {
	    Main.overview.viewSelector.disconnect(this._pageChangedId);
	    Main.overview.viewSelector.disconnect(this._pageEmptyId);
	    this._settings.disconnect(this._thumbnailsOnLeftSideId);
	    this._clickAction.disconnect(this._clickedId);
	    Main.mmOverview[this._monitorIndex].removeAction(this._clickAction);
    }
    
    _thumbnailsOnLeftSide() {
		let thumbnailsSlider;
		if (MultiMonitors.gnomeShellVersion()[1]<36)
			thumbnailsSlider = this._thumbnailsSlider.actor;
		else
			thumbnailsSlider = this._thumbnailsSlider;

    	if (this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)) {
    		let first = this._group.get_first_child();
    		if (first != thumbnailsSlider) {
                this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.LEFT;
                this._thumbnailsBox.remove_style_class_name('workspace-thumbnails');
               	this._thumbnailsBox.set_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._group.set_child_below_sibling(thumbnailsSlider, first)
    		}
    	}
    	else {
    		let last = this._group.get_last_child();
    		if (last != thumbnailsSlider) {
                this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.RIGHT;
               	this._thumbnailsBox.remove_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._thumbnailsBox.set_style_class_name('workspace-thumbnails');
                this._group.set_child_above_sibling(thumbnailsSlider, last);
    		}
    	}
    }

    getWorkspacesGeometry() {
    	if (!(Main.layoutManager.monitors.length>this._monitorIndex)) {
    		return { x: -1, y: -1, width: -1, height: -1 };
    	}
		let top_spacer_height = Main.layoutManager.primaryMonitor.height;
		
		let panelGhost_height = 0;
		if(Main.mmOverview[this._monitorIndex]._panelGhost)
			panelGhost_height = Main.mmOverview[this._monitorIndex]._panelGhost.get_height();
		
		let allocation;
		if (MultiMonitors.gnomeShellVersion()[1]<36)
			allocation = Main.overview._controls.actor.allocation;
		else
			allocation = Main.overview._overview._controls.allocation;
		let primaryControl_height = allocation.y2 - allocation.y1;
		let bottom_spacer_height = Main.layoutManager.primaryMonitor.height - allocation.y2;

		top_spacer_height -= primaryControl_height + panelGhost_height + bottom_spacer_height;
		top_spacer_height = Math.round(top_spacer_height);

		let spacer = Main.mmOverview[this._monitorIndex]._spacer;
		if (spacer.get_height()!=top_spacer_height)
			spacer.set_height(top_spacer_height);
	
        let [x, y] = this.actor.get_transformed_position();
        let [width, height] = this.actor.get_transformed_size();

        if (width < Main.layoutManager.monitors[this._monitorIndex].width*0.05) {
        	width = Main.layoutManager.monitors[this._monitorIndex].width;
        	height = Main.layoutManager.monitors[this._monitorIndex].height;
        	height -= top_spacer_height + panelGhost_height + bottom_spacer_height;
        	let _y = Main.layoutManager.monitors[this._monitorIndex].y;
        	if ((y-_y)<(top_spacer_height+panelGhost_height)) {
        		y +=  top_spacer_height;
        		x = Main.layoutManager.monitors[this._monitorIndex].x
        	}
        }
        
        let geometry = { x: x, y: y, width: width, height: height };
        let spacing = this.actor.get_theme_node().get_length('spacing');

        let thumbnailsWidth = this._thumbnailsSlider.getVisibleWidth() + spacing;

        geometry.width -= thumbnailsWidth;

        if(this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)){
            geometry.x += thumbnailsWidth;
        }
//        global.log("getWorkspacesGeometry x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
        return geometry;
    }
    
    isAnimationInProgress() {
    	return this._animationInProgress;
    }
    
    getWorkspacesFullGeometry() {
    	if (this._fullGeometry)
    		return this._fullGeometry;
    	else
    		return Main.layoutManager.monitors[this._monitorIndex];
    }
    
    getWorkspacesActualGeometry() {
        let [x, y] = this._viewActor.get_transformed_position();
        let allocation = this._viewActor.allocation;
        let width = allocation.x2 - allocation.x1;
        let height = allocation.y2 - allocation.y1;
        return { x: x, y: y, width: width, height: height };
    }
    
    _updateWorkspacesGeometry() {
    	this._fullGeometry = this.getWorkspacesGeometry();
    	if (!this._workspacesViews)
    		return;
        this._workspacesViews.setFullGeometry(this._fullGeometry);
    }

    _setVisibility() {
        // Ignore the case when we're leaving the overview, since
        // actors will be made visible again when entering the overview
        // next time, and animating them while doing so is just
        // unnecessary noise
        if (!Main.overview.visible ||
            (Main.overview.animationInProgress && !Main.overview.visibleTarget))
            return;

        let activePage = Main.overview.viewSelector.getActivePage();
    
        let thumbnailsVisible = (activePage == ViewSelector.ViewPage.WINDOWS);

        let opacity = null;
        if (thumbnailsVisible){
            this._thumbnailsSlider.slideIn();
            
        	opacity = 255;
        }
        else{
            this._thumbnailsSlider.slideOut();
            
        	opacity = 0;
        }
                
    	if (!this._workspacesViews)
    		return;
    	
        if (MultiMonitors.gnomeShellVersion()[1]==32) {
	        this._workspacesViews.actor.visible = opacity != 0;
        	Tweener.addTween((this._workspacesViews.actor, this._viewActor),
                { opacity: opacity,
                  time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                  transition: 'easeOutQuad'
                });
        }
		else if (MultiMonitors.gnomeShellVersion()[1]==34) {
	        this._workspacesViews.actor.visible = opacity != 0;
        	this._workspacesViews.actor.ease({
            	opacity: opacity,
            	mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            	duration: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME
        	});
		}
        else {
	        this._workspacesViews.visible = opacity != 0;
        	this._workspacesViews.ease({
            	opacity: opacity,
            	mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            	duration: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME
        	});
        }
    }

    _onPageEmpty() {
        this._thumbnailsSlider.pageEmpty();
    }
    
    show() {
		this._workspacesViews = Main.overview.viewSelector._workspacesDisplay._workspacesViews[this._monitorIndex];
    }

    hide() {
		if (MultiMonitors.gnomeShellVersion()[1]<36)
	    	if (this._workspacesViews && (!this._workspacesViews.actor.visible)) {
	    		this._workspacesViews.actor.opacity = 255;
	    		this._workspacesViews.actor.visible = true;
	    	}
		else
	    	if (this._workspacesViews && (!this._workspacesViews.visible)) {
	    		this._workspacesViews.opacity = 255;
	    		this._workspacesViews.visible = true;
	    	}
    	this._workspacesViews = null;
    }
};

var MultiMonitorsOverview = class MultiMonitorsOverview {
	constructor(index) {
		this.monitorIndex = index;
		this._settings = Convenience.getSettings();
		
        this._overview = new St.BoxLayout({ name: 'overview'+this.monitorIndex,
							                    accessible_name: _("Overview"+this.monitorIndex),
							                    vertical: true});
        this._overview.add_constraint(new LayoutManager.MonitorConstraint({ index: this.monitorIndex }));
        this._overview.connect('destroy', this._onDestroy.bind(this));
        this._overview._delegate = this;

        Main.layoutManager.overviewGroup.add_child(this._overview);

        this._showingId = null;
        this._hidingId = null;
	}
	
	init() {
		this._panelGhost = null;
		
		this._controls = new MultiMonitorsControlsManager(this.monitorIndex);
		
	    if (Main.mmPanel) {
	    	for (let idx in Main.mmPanel) {
	    		if (Main.mmPanel[idx].monitorIndex === this.monitorIndex) {
	    			this._panelGhost = new St.Bin({ child: new Clutter.Clone({source: Main.mmPanel[idx]}), reactive: false, opacity: 0 });
	    			this._overview.add_actor(this._panelGhost);
	    			break;
	    		}
	    	}
	    }

	    this._spacer = new St.Widget();
	    this._overview.add_actor(this._spacer);
		
		if (MultiMonitors.gnomeShellVersion()[1]<36) {
			this._overview.add(this._controls.actor, { y_fill: true, expand: true });
		}
		else {
			this._overview.add_actor(this._controls.actor);
		}
		
		this._controls.inOverviewInit();
		
		this._showingId = Main.overview.connect('showing', this._show.bind(this));
		this._hidingId = Main.overview.connect('hiding', this._hide.bind(this));
	}
	
	getWorkspacesFullGeometry() {
		return this._controls.getWorkspacesFullGeometry();
	}
	
	getWorkspacesActualGeometry() {
		if (this._controls.isAnimationInProgress())
			return null;
		return this._controls.getWorkspacesActualGeometry();
	}
	
    _onDestroy(actor) {
		if(this._showingId)
			Main.overview.disconnect(this._showingId);
	    if(this._hidingId)
	    	Main.overview.disconnect(this._hidingId);
	    
	    Main.layoutManager.overviewGroup.remove_child(this._overview);
	    
	    this._overview._delegate = null;
    }

	_show() {
	    this._controls.show();
	}
	
	_hide() {
		this._controls.hide();
	}
	
	destroy() {
		this._overview.destroy();
	}
	
	addAction(action) {
	    this._overview.add_action(action);
	}

	removeAction(action) {
		if(action.get_actor())
			this._overview.remove_action(action);
	}
};

var MultiMonitorsTouchpadSwipeGesture = (() => {
	if (MultiMonitors.gnomeShellVersion()[1]<36)
		return null;
	let MultiMonitorsTouchpadSwipeGesture = class MultiMonitorsTouchpadSwipeGesture extends GObject.Object {
	    _init(allowedModes) {
	        super._init();
	        this._allowedModes = allowedModes;
	        this._touchpadSettings = new Gio.Settings({
	            schema_id: 'org.gnome.desktop.peripherals.touchpad',
	        });
	        this._orientation = Clutter.Orientation.VERTICAL;
	        this._enabled = true;
	
	        this._capturedEventTouchpad = global.stage.connect('captured-event::touchpad', this._handleEvent.bind(this));
	    }

		destroy() {
			if (this._capturedEventTouchpad) {
				global.stage.disconnect(this._capturedEventTouchpad);
				this._capturedEventTouchpad = null;
			}
			this.run_dispose();
		}
	};
	MultiMonitors.copyClass(SwipeTracker.TouchpadSwipeGesture, MultiMonitorsTouchpadSwipeGesture);
	return GObject.registerClass({
		Properties: {
	        'enabled': GObject.ParamSpec.boolean(
	            'enabled', 'enabled', 'enabled',
	            GObject.ParamFlags.READWRITE,
	            true),
	        'orientation': GObject.ParamSpec.enum(
	            'orientation', 'orientation', 'orientation',
	            GObject.ParamFlags.READWRITE,
	            Clutter.Orientation, Clutter.Orientation.VERTICAL),
	    },
	    Signals: {
	        'begin':  { param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE] },
	        'update': { param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE] },
	        'end':    { param_types: [GObject.TYPE_UINT] },
	    }}, MultiMonitorsTouchpadSwipeGesture);
})();

var MultiMonitorsTouchSwipeGesture = (() => {
	if (MultiMonitors.gnomeShellVersion()[1]<36)
		return null;
	let MultiMonitorsTouchSwipeGesture = class MultiMonitorsTouchSwipeGesture extends Clutter.GestureAction {
    _init(allowedModes, nTouchPoints, thresholdTriggerEdge) {
        super._init();
        this.set_n_touch_points(nTouchPoints);
        this.set_threshold_trigger_edge(thresholdTriggerEdge);

        this._allowedModes = allowedModes;
        this._distance = global.screen_height;
        this._orientation = Clutter.Orientation.VERTICAL;

        this._grabOpBeginId = global.display.connect('grab-op-begin', () => {
            this.cancel();
        });

        this._lastPosition = 0;
	    }

		destroy() {
			if (this._grabOpBeginId) {
				this.cancel();
				global.display.disconnect(this._grabOpBeginId);
				this._grabOpBeginId = null;
			}
			this.run_dispose();
		}
	};
	MultiMonitors.copyClass(SwipeTracker.TouchSwipeGesture, MultiMonitorsTouchSwipeGesture);
	return GObject.registerClass({
		Properties: {
	        'distance': GObject.ParamSpec.double(
	            'distance', 'distance', 'distance',
	            GObject.ParamFlags.READWRITE,
	            0, Infinity, 0),
	        'orientation': GObject.ParamSpec.enum(
	            'orientation', 'orientation', 'orientation',
	            GObject.ParamFlags.READWRITE,
	            Clutter.Orientation, Clutter.Orientation.VERTICAL),
	    },
	    Signals: {
	        'begin':  { param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE] },
	        'update': { param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE] },
	        'end':    { param_types: [GObject.TYPE_UINT] },
	        'cancel': { param_types: [GObject.TYPE_UINT] },
	    }}, MultiMonitorsTouchSwipeGesture);
})();

var MultiMonitorsSwipeTracker = (() => {
	if (MultiMonitors.gnomeShellVersion()[1]<36)
		return null;
	let MultiMonitorsSwipeTracker = class MultiMonitorsSwipeTracker extends GObject.Object {
	    _init(actor, allowedModes, params) {
	        super._init();
	        params = Params.parse(params, { allowDrag: true, allowScroll: true });
	
	        this._allowedModes = allowedModes;
	        this._enabled = true;
	        this._orientation = Clutter.Orientation.VERTICAL;
	        this._distance = global.screen_height;
	
	        this._reset();
	
	        this._touchpadGesture = new MultiMonitorsTouchpadSwipeGesture(allowedModes);
	        this._touchpadGesture.connect('begin', this._beginGesture.bind(this));
	        this._touchpadGesture.connect('update', this._updateGesture.bind(this));
	        this._touchpadGesture.connect('end', this._endGesture.bind(this));
	        this.bind_property('enabled', this._touchpadGesture, 'enabled', 0);
	        this.bind_property('orientation', this._touchpadGesture, 'orientation', 0);
	
	        this._touchGesture = new MultiMonitorsTouchSwipeGesture(allowedModes, 4,
	            Clutter.GestureTriggerEdge.NONE);
	        this._touchGesture.connect('begin', this._beginTouchSwipe.bind(this));
	        this._touchGesture.connect('update', this._updateGesture.bind(this));
	        this._touchGesture.connect('end', this._endGesture.bind(this));
	        this._touchGesture.connect('cancel', this._cancelGesture.bind(this));
	        this.bind_property('enabled', this._touchGesture, 'enabled', 0);
	        this.bind_property('orientation', this._touchGesture, 'orientation', 0);
	        this.bind_property('distance', this._touchGesture, 'distance', 0);
	        global.stage.add_action(this._touchGesture);
	
	        if (params.allowDrag) {
	            this._dragGesture = new MultiMonitorsTouchSwipeGesture(allowedModes, 1,
	                Clutter.GestureTriggerEdge.AFTER);
	            this._dragGesture.connect('begin', this._beginGesture.bind(this));
	            this._dragGesture.connect('update', this._updateGesture.bind(this));
	            this._dragGesture.connect('end', this._endGesture.bind(this));
	            this._dragGesture.connect('cancel', this._cancelGesture.bind(this));
	            this.bind_property('enabled', this._dragGesture, 'enabled', 0);
	            this.bind_property('orientation', this._dragGesture, 'orientation', 0);
	            this.bind_property('distance', this._dragGesture, 'distance', 0);
	            actor.add_action(this._dragGesture);
	        } else {
	            this._dragGesture = null;
	        }
	
	        if (params.allowScroll) {
	            this._scrollGesture = new SwipeTracker.ScrollGesture(actor, allowedModes);
	            this._scrollGesture.connect('begin', this._beginGesture.bind(this));
	            this._scrollGesture.connect('update', this._updateGesture.bind(this));
	            this._scrollGesture.connect('end', this._endGesture.bind(this));
	            this.bind_property('enabled', this._scrollGesture, 'enabled', 0);
	            this.bind_property('orientation', this._scrollGesture, 'orientation', 0);
	        } else {
	            this._scrollGesture = null;
	        }
	    }

		destroy() {
			this._reset();
			if (this._touchpadGesture) {
				this._touchpadGesture.destroy();
				this._touchpadGesture = null;
			}
			if (this._touchGesture) {
				this._touchGesture.destroy();
				this._touchGesture = null;
			}
			if (this._dragGesture) {
				this._dragGesture.destroy();
				this._dragGesture = null;
			}
			if (this._scrollGesture) {
				this._scrollGesture.run_dispose();
				this._scrollGesture = null;
			}
			this.run_dispose();
		}
	};
	MultiMonitors.copyClass(SwipeTracker.SwipeTracker, MultiMonitorsSwipeTracker);
	return GObject.registerClass({
		Properties: {
	        'enabled': GObject.ParamSpec.boolean(
            'enabled', 'enabled', 'enabled',
	            GObject.ParamFlags.READWRITE,
	            true),
	        'orientation': GObject.ParamSpec.enum(
	            'orientation', 'orientation', 'orientation',
	            GObject.ParamFlags.READWRITE,
	            Clutter.Orientation, Clutter.Orientation.VERTICAL),
	        'distance': GObject.ParamSpec.double(
	            'distance', 'distance', 'distance',
	            GObject.ParamFlags.READWRITE,
	            0, Infinity, 0),
	    },
	    Signals: {
	        'begin':  { param_types: [GObject.TYPE_UINT] },
	        'update': { param_types: [GObject.TYPE_DOUBLE] },
	        'end':    { param_types: [GObject.TYPE_UINT64, GObject.TYPE_DOUBLE] },
	    }}, MultiMonitorsSwipeTracker);
})();

var MultiMonitorsWorkspacesDisplay = (() => {
	let MultiMonitorsWorkspacesDisplay = class MultiMonitorsWorkspacesDisplay extends St.Widget {
	    _init(scrollAdjustment) {
	        super._init({ clip_to_allocation: true });
	        this.connect('notify::allocation', this._updateWorkspacesActualGeometry.bind(this));
	
	        let workspaceManager = global.workspace_manager;
	        this._scrollAdjustment = scrollAdjustment;
	
	        this._switchWorkspaceId =
	            global.window_manager.connect('switch-workspace',
	                this._activeWorkspaceChanged.bind(this));
	
	        this._reorderWorkspacesdId =
	            workspaceManager.connect('workspaces-reordered',
	                this._workspacesReordered.bind(this));
	
	        let clickAction = new Clutter.ClickAction();
	        clickAction.connect('clicked', action => {
	            // Only switch to the workspace when there's no application
	            // windows open. The problem is that it's too easy to miss
	            // an app window and get the wrong one focused.
	            let event = Clutter.get_current_event();
	            let index = this._getMonitorIndexForEvent(event);
	            if ((action.get_button() == 1 || action.get_button() == 0) &&
	                this._workspacesViews[index].getActiveWorkspace().isEmpty())
	                Main.overview.hide();
	        });
	        Main.overview.addAction(clickAction);
	        this.bind_property('mapped', clickAction, 'enabled', GObject.BindingFlags.SYNC_CREATE);
	        this._clickAction = clickAction;
	
	        this._swipeTracker = new MultiMonitorsSwipeTracker(
	            Main.layoutManager.overviewGroup, Shell.ActionMode.OVERVIEW);
	        this._swipeTrackerBeginId = this._swipeTracker.connect('begin', this._switchWorkspaceBegin.bind(this));
	        this._swipeTrackerUpdateId = this._swipeTracker.connect('update', this._switchWorkspaceUpdate.bind(this));
	        this._swipeTrackerEndId = this._swipeTracker.connect('end', this._switchWorkspaceEnd.bind(this));
	        this.connect('notify::mapped', this._updateSwipeTracker.bind(this));

	        this._windowDragBeginId =
	            Main.overview.connect('window-drag-begin',
	                this._windowDragBegin.bind(this));
	        this._windowDragEndId =
	            Main.overview.connect('window-drag-begin',
	                this._windowDragEnd.bind(this));
	
	        this._primaryIndex = Main.layoutManager.primaryIndex;
	        this._workspacesViews = [];
	
	        this._settings = new Gio.Settings({ schema_id: WorkspacesView.MUTTER_SCHEMA });
	        this._settings.connect('changed::workspaces-only-on-primary',
	                               this._workspacesOnlyOnPrimaryChanged.bind(this));
	        this._workspacesOnlyOnPrimaryChanged();
	
	        this._notifyOpacityId = 0;
	        this._restackedNotifyId = 0;
	        this._scrollEventId = 0;
	        this._keyPressEventId = 0;
	        this._scrollTimeoutId = 0;
	
	        this._actualGeometry = null;
	        this._fullGeometry = null;
	        this._inWindowDrag = false;
	
	        this._gestureActive = false; // touch(pad) gestures
	        this._canScroll = true; // limiting scrolling speed
	
			this.connect('destroy', this._onDestroyMM.bind(this));
	    }

		_onDestroyMM() {
			this._onDestroy();
			if (this._swipeTracker) {
				this._swipeTracker.destroy();
				this._swipeTracker = null;
			}
		}
		
	    _workspacesOnlyOnPrimaryChanged() {
	        this._workspacesOnlyOnPrimary = this._settings.get_boolean('workspaces-only-on-primary');
	
	        if (!Main.overview.visible)
	            return;
	        
	        if (!this._fullGeometry)
	            return;
	
	        this._updateWorkspacesViews();
	    }

	    _switchWorkspaceBegin(tracker, monitor) {
	        if (this._workspacesOnlyOnPrimary && monitor !== this._primaryIndex)
	            return;
	
	        let workspaceManager = global.workspace_manager;
	        let adjustment = this._scrollAdjustment;
	        if (this._gestureActive)
	            adjustment.remove_transition('value');
	
	        tracker.orientation = workspaceManager.layout_rows !== -1
	            ? Clutter.Orientation.HORIZONTAL
	            : Clutter.Orientation.VERTICAL;
	
	        for (let i = 0; i < this._workspacesViews.length; i++)
	            this._workspacesViews[i].startTouchGesture();
	
	        let monitors = Main.layoutManager.monitors;
            let geometry;
            if (monitor == this._primaryIndex) {
            	geometry = this._fullGeometry;
            }
            else if (Main.mmOverview && Main.mmOverview[monitor]) {
            	geometry = Main.mmOverview[monitor].getWorkspacesFullGeometry();
            }
            else {
            	geometry = monitors[monitor];
            }
	        let distance = global.workspace_manager.layout_rows === -1
	            ? geometry.height : geometry.width;
	
	        let progress = adjustment.value / adjustment.page_size;
	        let points = Array.from(
	            { length: workspaceManager.n_workspaces }, (v, i) => i);
	
	        tracker.confirmSwipe(distance, points, progress, Math.round(progress));
	
	        this._gestureActive = true;
	    }
	    
	    _syncWorkspacesFullGeometry() {
	        if (this._workspacesViews.length!=Main.layoutManager.monitors.length)
	            return;
	
	        let monitors = Main.layoutManager.monitors;
	        for (let i = 0; i < monitors.length; i++) {
	            let geometry;
	            if (i == this._primaryIndex) {
	            	geometry = this._fullGeometry;
	            }
	            else if (Main.mmOverview && Main.mmOverview[i]) {
	            	geometry = Main.mmOverview[i].getWorkspacesFullGeometry();
	            }
	            else {
	            	geometry = monitors[i];
	            }
	//            global.log("fulllG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
	            this._workspacesViews[i].setFullGeometry(geometry);
	        }
	    }
	    
	    _syncWorkspacesActualGeometry() {
	        if (this._workspacesViews.length!=Main.layoutManager.monitors.length)
	            return;
	
	        let monitors = Main.layoutManager.monitors;
	        for (let i = 0; i < monitors.length; i++) {
	            let geometry;
	            if (i == this._primaryIndex) {
	            	geometry = this._actualGeometry;
	            }
	            else if (Main.mmOverview && Main.mmOverview[i]) {
	            	geometry = Main.mmOverview[i].getWorkspacesActualGeometry();
	            }
	            else {
	            	geometry = monitors[i];
	            }
	            if (geometry) {
	//                global.log("actualG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
	            	this._workspacesViews[i].setActualGeometry(geometry);
	            }
	        }
	    }
	};
	MultiMonitors.copyClass(WorkspacesView.WorkspacesDisplay, MultiMonitorsWorkspacesDisplay);
	return GObject.registerClass(MultiMonitorsWorkspacesDisplay);
})();

var MultiMonitorsWorkspacesDisplay34 = class MultiMonitorsWorkspacesDisplay34 extends WorkspacesView.WorkspacesDisplay {
    _workspacesOnlyOnPrimaryChanged() {
        this._workspacesOnlyOnPrimary = this._settings.get_boolean('workspaces-only-on-primary');

        if (!Main.overview.visible)
            return;
        
        if (!this._fullGeometry)
            return;

        this._updateWorkspacesViews();
    }
    
    _updateWorkspacesFullGeometry() {
        if (this._workspacesViews.length!=Main.layoutManager.monitors.length)
            return;

        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            let geometry;
            if (i == this._primaryIndex) {
            	geometry = this._fullGeometry;
            }
            else if (Main.mmOverview && Main.mmOverview[i]) {
            	geometry = Main.mmOverview[i].getWorkspacesFullGeometry();
            }
            else {
            	geometry = monitors[i];
            }
//            global.log("fulllG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
            this._workspacesViews[i].setFullGeometry(geometry);
        }
    }
    
    _updateWorkspacesActualGeometry() {
        if (this._workspacesViews.length!=Main.layoutManager.monitors.length)
            return;

        let [x, y] = this.actor.get_transformed_position();
        let allocation = this.actor.allocation;
        let width = allocation.x2 - allocation.x1;
        let height = allocation.y2 - allocation.y1;
        let primaryGeometry = { x: x, y: y, width: width, height: height };

        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            let geometry;
            if (i == this._primaryIndex) {
            	geometry = primaryGeometry;
            }
            else if (Main.mmOverview && Main.mmOverview[i]) {
            	geometry = Main.mmOverview[i].getWorkspacesActualGeometry();
            }
            else {
            	geometry = monitors[i];
            }
            if (geometry) {
//                global.log("actualG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
            	this._workspacesViews[i].setActualGeometry(geometry);
            }
        }
    }
};
