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

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;

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

const Config = imports.misc.config;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const THUMBNAILS_ON_LEFT_SIDE_ID = 'thumbnails-on-left-side';

const MultiMonitorsWorkspaceThumbnail = new Lang.Class({
    Name: 'MultiMonitorsWorkspaceThumbnail',
    Extends: WorkspaceThumbnail.WorkspaceThumbnail,

    _init : function(metaWorkspace, monitorIndex) {
        this.metaWorkspace = metaWorkspace;
        this.monitorIndex = monitorIndex;

        this._removed = false;

        this.actor = new St.Widget({ clip_to_allocation: true,
                                     style_class: 'workspace-thumbnail' });
        this.actor._delegate = this;

        this._contents = new Clutter.Actor();
        this.actor.add_child(this._contents);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

//        this._createBackground();
        this._bgManager = new Background.BackgroundManager({ monitorIndex: this.monitorIndex,
														        container: this._contents,
														        vignette: false });

        let monitor = Main.layoutManager.monitors[this.monitorIndex];
        this.setPorthole(monitor.x, monitor.y, monitor.width, monitor.height);

        let windows = global.get_window_actors().filter(Lang.bind(this, function(actor) {
            let win = actor.meta_window;
            return win.located_on_workspace(metaWorkspace);
        }));

        // Create clones for windows that should be visible in the Overview
        this._windows = [];
        //--- fix Ubuntu changes from js-fix-invalid-access-errors.patch
        this._windowsDestroyedIds = [];
        //---
        this._allWindows = [];
        this._minimizedChangedIds = [];
        for (let i = 0; i < windows.length; i++) {
            let minimizedChangedId =
                windows[i].meta_window.connect('notify::minimized',
                                               Lang.bind(this,
                                                         this._updateMinimized));
            this._allWindows.push(windows[i].meta_window);
            this._minimizedChangedIds.push(minimizedChangedId);

            if (this._isMyWindow(windows[i]) && this._isOverviewWindow(windows[i])) {
                this._addWindowClone(windows[i]);
            }
        }

        // Track window changes
        this._windowAddedId = this.metaWorkspace.connect('window-added',
                                                          Lang.bind(this, this._windowAdded));
        this._windowRemovedId = this.metaWorkspace.connect('window-removed',
                                                           Lang.bind(this, this._windowRemoved));
        this._windowEnteredMonitorId = global.screen.connect('window-entered-monitor',
                                                           Lang.bind(this, this._windowEnteredMonitor));
        this._windowLeftMonitorId = global.screen.connect('window-left-monitor',
                                                           Lang.bind(this, this._windowLeftMonitor));

        this.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
        this._slidePosition = 0; // Fully slid in
        this._collapseFraction = 0; // Not collapsed
    }
});

const MultiMonitorsThumbnailsBox = new Lang.Class({
    Name: 'MultiMonitorsThumbnailsBox',
    Extends: WorkspaceThumbnail.ThumbnailsBox,
    
    _init: function(monitorIndex) {
    	this._monitorIndex = monitorIndex;
    	
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');

        this.actor = new Shell.GenericContainer({ reactive: true,
									            style_class: 'workspace-thumbnails',
									            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT });
		this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
		this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
		this.actor.connect('allocate', Lang.bind(this, this._allocate));
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
		this.actor._delegate = this;
		
		let indicator = new St.Bin({ style_class: 'workspace-thumbnail-indicator' });
		
		// We don't want the indicator to affect drag-and-drop
		Shell.util_set_hidden_from_pick(indicator, true);
		
		this._indicator = indicator;
		this.actor.add_actor(indicator);
		
		this._dropWorkspace = -1;
		this._dropPlaceholderPos = -1;
		this._dropPlaceholder = new St.Bin({ style_class: 'placeholder' });
		this.actor.add_actor(this._dropPlaceholder);
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
        this._switchWorkspaceNotifyId = 0;
        this._nWorkspacesNotifyId = 0;
        this._syncStackingId = 0;
        this._porthole = null;
		
		this.actor.connect('button-press-event', function() { return Clutter.EVENT_STOP; });
		this.actor.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
		
		this.actor.connect('touch-event', Lang.bind(this, this._onTouchEvent));
		
		this._showingId = Main.overview.connect('showing', Lang.bind(this, this._createThumbnails));
		this._hiddenId = Main.overview.connect('hidden', Lang.bind(this, this._destroyThumbnails));
		
		this._itemDragBeginId = Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
		this._itemDragEndId = Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));
		this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled', Lang.bind(this, this._onDragCancelled));
		this._windowDragBeginId = Main.overview.connect('window-drag-begin', Lang.bind(this, this._onDragBegin));
		this._windowDragEndId = Main.overview.connect('window-drag-end', Lang.bind(this, this._onDragEnd));
		this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled', Lang.bind(this, this._onDragCancelled));
		
		this._settings = new Gio.Settings({ schema_id: WorkspaceThumbnail.OVERRIDE_SCHEMA });
		this._changedDynamicWorkspacesId = this._settings.connect('changed::dynamic-workspaces',
												Lang.bind(this, this._updateSwitcherVisibility));
		
		if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
	        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, function() {
	            this._destroyThumbnails();
	            if (Main.overview.visible)
	                this._createThumbnails();
	        }));
		}
    },
    
    _onDestroy: function(actor) {
        this._destroyThumbnails();

		Main.overview.disconnect(this._showingId);
		Main.overview.disconnect(this._hiddenId);
		
		Main.overview.disconnect(this._itemDragBeginId);
		Main.overview.disconnect(this._itemDragEndId);
		Main.overview.disconnect(this._itemDragCancelledId);
		Main.overview.disconnect(this._windowDragBeginId);
		Main.overview.disconnect(this._windowDragEndId);
		Main.overview.disconnect(this._windowDragCancelledId);

        this._settings.disconnect(this._changedDynamicWorkspacesId);
        if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
        	Main.layoutManager.disconnect(this._monitorsChangedId);
        }
        //TODO drag end ??

        Tweener.removeTweens(actor);
        
        this.actor._delegate = null;
    },

    addThumbnails: function(start, count) {
    	if (this._currentVersion[0]==3 && this._currentVersion[1]>24) {
	        if (!this._ensurePorthole())
	            return;
    	}
    	else {
    		this._ensurePorthole24();
    	}
        
        for (let k = start; k < start + count; k++) {
            let metaWorkspace = global.screen.get_workspace_by_index(k);

            let thumbnail = new MultiMonitorsWorkspaceThumbnail(metaWorkspace, this._monitorIndex);

            thumbnail.setPorthole(this._porthole.x, this._porthole.y,
                                  this._porthole.width, this._porthole.height);
            this._thumbnails.push(thumbnail);
            this.actor.add_actor(thumbnail.actor);

            if (start > 0 && this._spliceIndex == -1) {
                // not the initial fill, and not splicing via DND
                thumbnail.state = WorkspaceThumbnail.ThumbnailState.NEW;
                thumbnail.slidePosition = 1; // start slid out
                this._haveNewThumbnails = true;
            } else {
                thumbnail.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
            }

            this._stateCounts[thumbnail.state]++;
        }

        this._queueUpdateStates();

        // The thumbnails indicator actually needs to be on top of the thumbnails
        this._indicator.raise_top();

        // Clear the splice index, we got the message
        this._spliceIndex = -1;
    },
    // The "porthole" is the portion of the screen that we show in the
    // workspaces
    _ensurePorthole: function() {
        if (!(Main.layoutManager.monitors.length>this._monitorIndex))
            return false;
        
        if (!this._porthole)
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
        
        return true;
    },
    _ensurePorthole24: function() {
        if (!this._porthole)
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
    },
});

const MultiMonitorsSlidingControl = new Lang.Class({
    Name: 'MultiMonitorsSlidingControl',
    Extends: OverviewControls.SlidingControl,
    
    _init: function(params) {
        params = Params.parse(params, { slideDirection: OverviewControls.SlideDirection.LEFT });

        this._visible = true;
        this._inDrag = false;

        this.layout = new OverviewControls.SlideLayout();
        this.layout.slideDirection = params.slideDirection;
        this.layout.translationX = 0;
        this.actor = new St.Widget({ layout_manager: this.layout,
                                     style_class: 'overview-controls',
                                     clip_to_allocation: true });

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        
        this._hidingId = Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHiding));

        this._itemDragBeginId = Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
        this._itemDragEndId = Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));
        this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled', Lang.bind(this, this._onDragEnd));

        this._windowDragBeginId = Main.overview.connect('window-drag-begin', Lang.bind(this, this._onWindowDragBegin));
        this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled', Lang.bind(this, this._onWindowDragEnd));
        this._windowDragEndId = Main.overview.connect('window-drag-end', Lang.bind(this, this._onWindowDragEnd));
        
        this.onAnimationBegin = null;
        this.onAnimationEnd = null;
    },
    
    _onDestroy: function(actor) {
    	Main.overview.disconnect(this._hidingId);
	    
    	Main.overview.disconnect(this._itemDragBeginId);
    	Main.overview.disconnect(this._itemDragEndId);
    	Main.overview.disconnect(this._itemDragCancelledId);

    	Main.overview.disconnect(this._windowDragBeginId);
    	Main.overview.disconnect(this._windowDragCancelledId);
    	Main.overview.disconnect(this._windowDragEndId);
    	
    	Tweener.removeTweens(actor);
    },
    
    _updateTranslation: function() {
        let translationStart = 0;
        let translationEnd = 0;
        let translation = this._getTranslation();

        let shouldShow = (this._getSlide() > 0);
        if (shouldShow) {
            translationStart = translation;
        } else {
            translationEnd = translation;
        }

        if (this.layout.translationX == translationEnd)
            return;

        this.layout.translationX = translationStart;
        if (this.onAnimationBegin) this.onAnimationBegin();
        Tweener.addTween(this.layout, { translationX: translationEnd,
                                        time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                                        transition: 'easeOutQuad',
                                        onComplete: function() {
                                      	  if (this.onAnimationEnd) this.onAnimationEnd();
                                        },
                                        onCompleteScope: this});
    },
});

const MultiMonitorsThumbnailsSlider = new Lang.Class({
    Name: 'MultiMonitorsThumbnailsSlider',
    Extends: MultiMonitorsSlidingControl,

    _init: function(thumbnailsBox) {
        this.parent({ slideDirection: OverviewControls.SlideDirection.RIGHT });

        this._currentVersion = Config.PACKAGE_VERSION.split('.');
        
        this._thumbnailsBox = thumbnailsBox;

        this.actor.request_mode = Clutter.RequestMode.WIDTH_FOR_HEIGHT;
        this.actor.reactive = true;
        this.actor.track_hover = true;
        this.actor.add_actor(this._thumbnailsBox.actor);
        
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._updateSlide));
        this.actor.connect('notify::hover', Lang.bind(this, this._updateSlide));
        
        if(this._currentVersion[0]==3 && this._currentVersion[1]<26) {
        	this._switchWorkspaceId = global.window_manager.connect('switch-workspace', Lang.bind(this, this._updateSlide));
        }
        
        this._thumbnailsBox.actor.bind_property('visible', this.actor, 'visible', GObject.BindingFlags.SYNC_CREATE);
    },
    
    _onDestroy: function() {
    	Main.layoutManager.disconnect(this._monitorsChangedId);
    	if(this._currentVersion[0]==3 && this._currentVersion[1]<26) {
    		global.window_manager.disconnect(this._switchWorkspaceId);
    	}
    	this.parent();
	},
	
	_getAlwaysZoomOut: OverviewControls.ThumbnailsSlider.prototype._getAlwaysZoomOut,
    getNonExpandedWidth: OverviewControls.ThumbnailsSlider.prototype.getNonExpandedWidth,
    _getSlide: OverviewControls.ThumbnailsSlider.prototype._getSlide,
    getVisibleWidth: OverviewControls.ThumbnailsSlider.prototype.getVisibleWidth,
});

const MultiMonitorsControlsManager = new Lang.Class({
    Name: 'MultiMonitorsControlsManager',

    _init: function(index) {
    	this._monitorIndex = index;
    	this._workspacesViews = null;
    	
    	this._fullGeometry = null;
    	this._animationInProgress = false;
    	
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
    	
        this._thumbnailsBox = new MultiMonitorsThumbnailsBox(this._monitorIndex);
        this._thumbnailsSlider = new MultiMonitorsThumbnailsSlider(this._thumbnailsBox);
        
        this._thumbnailsSlider.onAnimationBegin = Lang.bind(this, function() {
        	this._animationInProgress = true;
        });
        this._thumbnailsSlider.onAnimationEnd = Lang.bind(this, function() {
        	this._animationInProgress = false;
        	if(!this._workspacesViews)
        		return;
        	let geometry = this.getWorkspacesActualGeometry();
//        	global.log("actualG+ i: "+this._monitorIndex+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
        	this._workspacesViews.setActualGeometry(geometry);
		});

        let reactiveFlag = false;
        if(this._currentVersion[0]==3 && this._currentVersion[1]<22)
        	reactiveFlag = true;
        
        let layout = new OverviewControls.ControlsLayout();
        this.actor = new St.Widget({ layout_manager: layout,
                                     reactive: reactiveFlag,
                                     x_expand: true, y_expand: true,
                                     clip_to_allocation: true });
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        
        
        this._group = new St.BoxLayout({ name: 'mm-overview-group',
                                        x_expand: true, y_expand: true });
        this.actor.add_actor(this._group);
        
        this._viewActor = new St.Widget({ clip_to_allocation: true });

        this._group.add(this._viewActor, { x_fill: true,
        									expand: true });
        
        this._group.add_actor(this._thumbnailsSlider.actor);

        layout.connect('allocation-changed', Lang.bind(this, this._updateWorkspacesGeometry));
        this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));
        
        this._settings = Convenience.getSettings();
        this._thumbnailsOnLeftSideId = this._settings.connect('changed::'+THUMBNAILS_ON_LEFT_SIDE_ID,
        													Lang.bind(this, this._thumbnailsOnLeftSide));
        this._thumbnailsOnLeftSide();
        
	    this._pageChangedId = Main.overview.viewSelector.connect('page-changed', Lang.bind(this, this._setVisibility));
	    this._pageEmptyId = Main.overview.viewSelector.connect('page-empty', Lang.bind(this, this._onPageEmpty));
	    
	    this._clickAction = new Clutter.ClickAction()
        this._clickedId = this._clickAction.connect('clicked', Lang.bind(this, function(action) {
            if (action.get_button() == 1 && this._workspacesViews &&
            								this._workspacesViews.getActiveWorkspace().isEmpty())
                Main.overview.hide();
        }));
	    
	    Main.mmOverview[this._monitorIndex].addAction(this._clickAction);
    },
    
    inOverviewInit: function() {
	    if (Main.overview.visible) {
	    	this._thumbnailsBox._createThumbnails();
	        let activePage = Main.overview.viewSelector.getActivePage();
	        if (activePage != ViewSelector.ViewPage.WINDOWS) {
	        	this._thumbnailsSlider.slideOut();
	        	this._thumbnailsSlider.pageEmpty();
	        }
	    	this.show();
	    }	
    },
    
	_onScrollEvent: function(actor, event) {
		if (!this.actor.mapped)
			return Clutter.EVENT_PROPAGATE;
		let activeWs = global.screen.get_active_workspace();
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
	},
	
    _onDestroy: function() {
	    Main.overview.viewSelector.disconnect(this._pageChangedId);
	    Main.overview.viewSelector.disconnect(this._pageEmptyId);
	    this._settings.disconnect(this._thumbnailsOnLeftSideId);
	    
	    this._clickAction.disconnect(this._clickedId);
	    Main.mmOverview[this._monitorIndex].removeAction(this._clickAction);
    },
    
    _thumbnailsOnLeftSide: function() {
    	if(this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)){
    		let first = this._group.get_first_child();
    		if(first != this._thumbnailsSlider.actor){
                this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.LEFT;
                this._thumbnailsBox.actor.remove_style_class_name('workspace-thumbnails');
               	this._thumbnailsBox.actor.set_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._group.set_child_below_sibling(this._thumbnailsSlider.actor, first)
    		}
    	}
    	else{
    		let last = this._group.get_last_child();
    		if(last != this._thumbnailsSlider.actor){
                this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.RIGHT;
               	this._thumbnailsBox.actor.remove_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._thumbnailsBox.actor.set_style_class_name('workspace-thumbnails');
                this._group.set_child_above_sibling(this._thumbnailsSlider.actor, last);
    		}
    	}
    },

    getWorkspacesGeometry: function() {
    	if (!(Main.layoutManager.monitors.length>this._monitorIndex)) {
    		return { x: -1, y: -1, width: -1, height: -1 };
    	}
		let top_spacer_height = Main.layoutManager.primaryMonitor.height;
		
		let panelGhost_height = 0;
		if(Main.mmOverview[this._monitorIndex]._panelGhost)
			panelGhost_height = Main.mmOverview[this._monitorIndex]._panelGhost.get_height();
		
		let allocation = Main.overview._controls.actor.allocation;
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
//        global.log("getWorkspacesGeometry x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
        let spacing = this.actor.get_theme_node().get_length('spacing');

        let thumbnailsWidth = this._thumbnailsSlider.getVisibleWidth() + spacing;
        
        geometry.width -= thumbnailsWidth;

        if(this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)){
            geometry.x += thumbnailsWidth;
        }
        return geometry;
    },
    
    isAnimationInProgress: function() {
    	return this._animationInProgress;
    },
    
    getWorkspacesFullGeometry: function() {
    	if (this._fullGeometry)
    		return this._fullGeometry;
    	else
    		return Main.layoutManager.monitors[this._monitorIndex];
    },
    
    getWorkspacesActualGeometry: function() {
        let [x, y] = this._viewActor.get_transformed_position();
        let allocation = this._viewActor.allocation;
        let width = allocation.x2 - allocation.x1;
        let height = allocation.y2 - allocation.y1;
        return { x: x, y: y, width: width, height: height };
    },
    
    _updateWorkspacesGeometry: function() {
    	this._fullGeometry = this.getWorkspacesGeometry();
    	if(!this._workspacesViews)
    		return;
        this._workspacesViews.setFullGeometry(this._fullGeometry);
    },

    _setVisibility: function() {
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
        
    	if(!this._workspacesViews)
    		return;

        this._workspacesViews.actor.visible = opacity != 0;
        Tweener.addTween((this._workspacesViews.actor, this._viewActor),
                { opacity: opacity,
                  time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                  transition: 'easeOutQuad'
                });
    },

    _onPageEmpty: function() {
        this._thumbnailsSlider.pageEmpty();
    },
    
    show: function() {
		this._workspacesViews = Main.overview.viewSelector._workspacesDisplay._workspacesViews[this._monitorIndex];
    },

    hide: function() {
    	if (this._workspacesViews && (!this._workspacesViews.actor.visible)) {
    		this._workspacesViews.actor.opacity = 255;
    		this._workspacesViews.actor.visible = true;
    	}
    	this._workspacesViews = null;
    }
});

var MultiMonitorsOverview = new Lang.Class({
	Name: 'MultiMonitorsOverview',
	
	_init: function(index) {
		this.monitorIndex = index;
		this._settings = Convenience.getSettings();
		
        this._overview = new St.BoxLayout({ name: 'overview'+this.monitorIndex,
							                    accessible_name: _("Overview"+this.monitorIndex),
							                    vertical: true});
        this._overview.add_constraint(new LayoutManager.MonitorConstraint({ index: this.monitorIndex }));
        this._overview.connect('destroy', Lang.bind(this, this._onDestroy));
        this._overview._delegate = this;

        Main.layoutManager.overviewGroup.add_child(this._overview);

        this._showingId = null;
        this._hidingId = null;
	},
	
	init: function() {
		this._panelGhost = null;
		
	    if (Main.mmPanel) {
	    	for (let idx in Main.mmPanel) {
	    		if (Main.mmPanel[idx].monitorIndex === this.monitorIndex) {
	    			this._panelGhost = new St.Bin({ child: new Clutter.Clone({source: Main.mmPanel[idx].actor}), reactive: false, opacity: 0 });
	    			this._overview.add_actor(this._panelGhost);
	    			break;
	    		}
	    	}
	    }

	    this._spacer = new St.Widget();
	    this._overview.add_actor(this._spacer);
		
		this._controls = new MultiMonitorsControlsManager(this.monitorIndex);
		this._overview.add(this._controls.actor, { y_fill: true, expand: true });
		this._controls.inOverviewInit();
		
		this._showingId = Main.overview.connect('showing', Lang.bind(this, this._show));
		this._hidingId = Main.overview.connect('hiding', Lang.bind(this, this._hide));
	},
	
	getWorkspacesFullGeometry: function() {
		return this._controls.getWorkspacesFullGeometry();
	},
	
	getWorkspacesActualGeometry: function() {
		if (this._controls.isAnimationInProgress())
			return null;
		return this._controls.getWorkspacesActualGeometry();
	},
	
    _onDestroy: function(actor) {
		if(this._showingId)
			Main.overview.disconnect(this._showingId);
	    if(this._hidingId)
	    	Main.overview.disconnect(this._hidingId);
	    
	    Main.layoutManager.overviewGroup.remove_child(this._overview);
	    
	    this._overview._delegate = null;
    },

	_show: function() {
	    this._controls.show();
	},
	
	_hide: function() {
		this._controls.hide();
	},
	
	destroy: function() {
		this._overview.destroy();
	},
	
	addAction: function(action) {
//	    if (this.isDummy)
//	        return;
	
	    this._overview.add_action(action);
//	    _overview >> _backgroundGroup
	},

	removeAction: function(action) {
		if(action.get_actor())
			this._overview.remove_action(action);
	}

});


var MultiMonitorsWorkspacesDisplay = new Lang.Class({
	Name: 'MultiMonitorsWorkspacesDisplay',
    Extends: WorkspacesView.WorkspacesDisplay,
    
    _init: function() {
    	this.parent();
    	this._restackedNotifyId = 0;
    },
    
    _workspacesOnlyOnPrimaryChanged: function() {
        this._workspacesOnlyOnPrimary = this._settings.get_boolean('workspaces-only-on-primary');

        if (!Main.overview.visible)
            return;
        
        if (!this._fullGeometry)
            return;

        this._updateWorkspacesViews();
    },
    
    _updateWorkspacesFullGeometry: function() {
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
    },
    
    _updateWorkspacesActualGeometry: function() {
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

});
