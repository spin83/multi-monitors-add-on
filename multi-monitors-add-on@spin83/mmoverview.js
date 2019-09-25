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

const {Clutter, GObject, St, Shell, Gio, Meta} = imports.gi;

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

const ExtensionUtils = imports.misc.extensionUtils;
const CE = ExtensionUtils.getCurrentExtension();
const MultiMonitors = CE.imports.extension;
const Convenience = CE.imports.convenience;

const THUMBNAILS_ON_LEFT_SIDE_ID = 'thumbnails-on-left-side';

const MultiMonitorsWorkspaceThumbnail = (() => {
    let MultiMonitorsWorkspaceThumbnail = class MultiMonitorsWorkspaceThumbnail extends St.Widget {
        _init(metaWorkspace, monitorIndex) {
            this.metaWorkspace = metaWorkspace;
            this.monitorIndex = monitorIndex;

            this._removed = false;

            super._init({
                clip_to_allocation: true,
                style_class: 'workspace-thumbnail'
            });

            this._delegate = this;

            this._contents = new Clutter.Actor();
            this.add_child(this._contents);

            this.connect('destroy', this._onDestroy.bind(this));

            //        this._createBackground();
            this._bgManager = new Background.BackgroundManager({
                monitorIndex: this.monitorIndex,
                container: this._contents,
                vignette: false
            });

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
    };
    MultiMonitors.copyClass(WorkspaceThumbnail.WorkspaceThumbnail, MultiMonitorsWorkspaceThumbnail);
    return GObject.registerClass(MultiMonitorsWorkspaceThumbnail);
})();


const MultiMonitorsThumbnailsBox = (() => {
    let MultiMonitorsThumbnailsBox = class MultiMonitorsThumbnailsBox extends St.Widget {
        _init(monitorIndex) {
            this._monitorIndex = monitorIndex;

            super._init({
                reactive: true,
                style_class: 'workspace-thumbnails',
                request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT
            });

            this._delegate = this;

            let indicator = new St.Bin({style_class: 'workspace-thumbnail-indicator'});

            // We don't want the indicator to affect drag-and-drop
            Shell.util_set_hidden_from_pick(indicator, true);

            this._indicator = indicator;
            this.add_actor(indicator);

            // The porthole is the part of the screen we're showing in the thumbnails
            this._porthole = {
                width: global.stage.width, height: global.stage.height,
                x: global.stage.x, y: global.stage.y
            };

            this._dropWorkspace = -1;
            this._dropPlaceholderPos = -1;
            this._dropPlaceholder = new St.Bin({style_class: 'placeholder'});
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

            this.connect('button-press-event', () => Clutter.EVENT_STOP);
            this.connect('button-release-event', this._onButtonRelease.bind(this));
            this.connect('touch-event', this._onTouchEvent.bind(this));

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

            this._settings = new Gio.Settings({schema_id: WorkspaceThumbnail.MUTTER_SCHEMA});
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
            this._nWorkspacesNotifyId = 0;
            this._syncStackingId = 0;
            this._workareasChangedId = 0;

            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy(actor) {
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
            Main.layoutManager.disconnect(this._monitorsChangedId);
            global.display.disconnect(this._workareasChangedPortholeId);

            Tweener.removeTweens(actor);
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
        }

        _updatePorthole() {
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
            this.queue_relayout();
        }
    };
    MultiMonitors.copyClass(WorkspaceThumbnail.ThumbnailsBox, MultiMonitorsThumbnailsBox);
    return GObject.registerClass(MultiMonitorsThumbnailsBox);
})();

const MultiMonitorsSlidingControl = (() => {
    let MultiMonitorsSlidingControl = class MultiMonitorsSlidingControl extends St.Widget {
        _init(params) {

            params = Params.parse(params, {slideDirection: OverviewControls.SlideDirection.LEFT});

            this._visible = true;
            this._inDrag = false;

            this.layout = new OverviewControls.SlideLayout();
            this.layout.slideDirection = params.slideDirection;
            this.layout.translationX = 0;

            super._init({
                layout_manager: this.layout,
                style_class: 'overview-controls',
                clip_to_allocation: true,
            });

            this.connect('destroy', this._onDestroy.bind(this));

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

            Tweener.removeTweens(this);
            Tweener.removeTweens(this.layout);
        }

        _updateTranslation() {
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
            Tweener.addTween(this.layout, {
                translationX: translationEnd,
                time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                transition: 'easeOutQuad',
                onComplete() {
                    if (this.onAnimationEnd) this.onAnimationEnd();
                },
                onCompleteScope: this
            });
        }
    };
    MultiMonitors.copyClass(OverviewControls.SlidingControl, MultiMonitorsSlidingControl);
    return GObject.registerClass(MultiMonitorsSlidingControl);
})();

const MultiMonitorsThumbnailsSlider = (() => {
    let MultiMonitorsThumbnailsSlider = class MultiMonitorsThumbnailsSlider extends MultiMonitorsSlidingControl {
        _init(thumbnailsBox) {
            super._init({slideDirection: OverviewControls.SlideDirection.RIGHT});

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

const MultiMonitorsControlsManager = (() => {
    let MultiMonitorsControlsManager = class MultiMonitorsControlsManager extends St.Widget {
        _init(index) {
            this._monitorIndex = index;
            this._workspacesViews = null;

            this._fullGeometry = null;
            this._animationInProgress = false;

            this._thumbnailsBox = new MultiMonitorsThumbnailsBox(this._monitorIndex);
            this._thumbnailsSlider = new MultiMonitorsThumbnailsSlider(this._thumbnailsBox);

            this._thumbnailsSlider.onAnimationBegin = () => {
                this._animationInProgress = true;
            };
            this._thumbnailsSlider.onAnimationEnd = () => {
                this._animationInProgress = false;
                if (!this._workspacesViews)
                    return;
                let geometry = this.getWorkspacesActualGeometry();
                //        	global.log("actualG+ i: "+this._monitorIndex+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
                this._workspacesViews.setActualGeometry(geometry);
            };

			let layout = new OverviewControls.ControlsLayout();
			super._init({
				layout_manager: layout,
				x_expand: true, y_expand: true,
				clip_to_allocation: true,
			});
            this.connect('destroy', this._onDestroy.bind(this));


            this._group = new St.BoxLayout({
                name: 'mm-overview-group',
                x_expand: true, y_expand: true
            });
            this.add_actor(this._group);

            this._viewActor = new St.Widget({clip_to_allocation: true});

            this._group.add(this._viewActor, {
                x_fill: true,
                expand: true
            });

            this._group.add_actor(this._thumbnailsSlider);

            layout.connect('allocation-changed', this._updateWorkspacesGeometry.bind(this));
            this.connect('scroll-event', this._onScrollEvent.bind(this));

            this._settings = Convenience.getSettings();
            this._thumbnailsOnLeftSideId = this._settings.connect('changed::' + THUMBNAILS_ON_LEFT_SIDE_ID,
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

        _onScrollEvent(actor, event) {
            if (!this.mapped)
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
            if (this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)) {
                let first = this._group.get_first_child();
                if (first != this._thumbnailsSlider) {
                    this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.LEFT;
                    this._thumbnailsBox.remove_style_class_name('workspace-thumbnails');
                    this._thumbnailsBox.set_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                    this._group.set_child_below_sibling(this._thumbnailsSlider, first)
                }
            } else {
                let last = this._group.get_last_child();
                if (last != this._thumbnailsSlider) {
                    this._thumbnailsSlider.layout.slideDirection = OverviewControls.SlideDirection.RIGHT;
                    this._thumbnailsBox.remove_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                    this._thumbnailsBox.set_style_class_name('workspace-thumbnails');
                    this._group.set_child_above_sibling(this._thumbnailsSlider, last);
                }
            }
        }

        getWorkspacesGeometry() {
            if (!(Main.layoutManager.monitors.length > this._monitorIndex)) {
                return {x: -1, y: -1, width: -1, height: -1};
            }
            let top_spacer_height = Main.layoutManager.primaryMonitor.height;

            let panelGhost_height = 0;
            if (Main.mmOverview[this._monitorIndex]._panelGhost)
                panelGhost_height = Main.mmOverview[this._monitorIndex]._panelGhost.get_height();

            let allocation = Main.overview._controls.allocation;
            let primaryControl_height = allocation.y2 - allocation.y1;
            let bottom_spacer_height = Main.layoutManager.primaryMonitor.height - allocation.y2;

            top_spacer_height -= primaryControl_height + panelGhost_height + bottom_spacer_height;
            top_spacer_height = Math.round(top_spacer_height);

            let spacer = Main.mmOverview[this._monitorIndex]._spacer;
            if (spacer.get_height() != top_spacer_height)
                spacer.set_height(top_spacer_height);

            let [x, y] = this.get_transformed_position();
            let [width, height] = this.get_transformed_size();

            if (width < Main.layoutManager.monitors[this._monitorIndex].width * 0.05) {
                width = Main.layoutManager.monitors[this._monitorIndex].width;
                height = Main.layoutManager.monitors[this._monitorIndex].height;
                height -= top_spacer_height + panelGhost_height + bottom_spacer_height;
                let _y = Main.layoutManager.monitors[this._monitorIndex].y;
                if ((y - _y) < (top_spacer_height + panelGhost_height)) {
                    y += top_spacer_height;
                    x = Main.layoutManager.monitors[this._monitorIndex].x
                }
            }

            let geometry = {x: x, y: y, width: width, height: height};
            let spacing = this.get_theme_node().get_length('spacing');

            let thumbnailsWidth = this._thumbnailsSlider.getVisibleWidth() + spacing;

            geometry.width -= thumbnailsWidth;

            if (this._settings.get_boolean(THUMBNAILS_ON_LEFT_SIDE_ID)) {
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
            return {x: x, y: y, width: width, height: height};
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
            if (thumbnailsVisible) {
                this._thumbnailsSlider.slideIn();

                opacity = 255;
            } else {
                this._thumbnailsSlider.slideOut();

                opacity = 0;
            }

            if (!this._workspacesViews)
                return;

            this._workspacesViews.visible = opacity != 0;
            Tweener.addTween((this._workspacesViews, this._viewActor),
                {
                    opacity: opacity,
                    time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                    transition: 'easeOutQuad'
                });
        }

        _onPageEmpty() {
            this._thumbnailsSlider.pageEmpty();
        }

        show() {
            this._workspacesViews = Main.overview.viewSelector._workspacesDisplay._workspacesViews[this._monitorIndex];
        }

        hide() {
            if (this._workspacesViews && (!this._workspacesViews.visible)) {
                this._workspacesViews.opacity = 255;
                this._workspacesViews.visible = true;
            }
            this._workspacesViews = null;
        }
    };
    return GObject.registerClass(MultiMonitorsControlsManager);
})();

var MultiMonitorsOverview = class MultiMonitorsOverview {
    constructor(index) {
        this.monitorIndex = index;
        this._settings = Convenience.getSettings();

        this._overview = new St.BoxLayout({
            name: 'overview' + this.monitorIndex,
            accessible_name: _("Overview" + this.monitorIndex),
            vertical: true
        });
        this._overview.add_constraint(new LayoutManager.MonitorConstraint({index: this.monitorIndex}));
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
                    this._panelGhost = new St.Bin({
                        child: new Clutter.Clone({source: Main.mmPanel[idx]}),
                        reactive: false,
                        opacity: 0
                    });
                    this._overview.add_actor(this._panelGhost);
                    break;
                }
            }
        }

        this._spacer = new St.Widget();
        this._overview.add_actor(this._spacer);

        this._overview.add(this._controls, {y_fill: true, expand: true});
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
        if (this._showingId)
            Main.overview.disconnect(this._showingId);
        if (this._hidingId)
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
        if (action.get_actor())
            this._overview.remove_action(action);
    }
};


var MultiMonitorsWorkspacesDisplay = class MultiMonitorsWorkspacesDisplay extends WorkspacesView.WorkspacesDisplay {
    _workspacesOnlyOnPrimaryChanged() {
        this._workspacesOnlyOnPrimary = this._settings.get_boolean('workspaces-only-on-primary');

        if (!Main.overview.visible)
            return;

        if (!this._fullGeometry)
            return;

        this._updateWorkspacesViews();
    }

    _updateWorkspacesFullGeometry() {
        if (this._workspacesViews.length != Main.layoutManager.monitors.length)
            return;

        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            let geometry;
            if (i == this._primaryIndex) {
                geometry = this._fullGeometry;
            } else if (Main.mmOverview && Main.mmOverview[i]) {
                geometry = Main.mmOverview[i].getWorkspacesFullGeometry();
            } else {
                geometry = monitors[i];
            }
//            global.log("fulllG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
            this._workspacesViews[i].setFullGeometry(geometry);
        }
    }

    _updateWorkspacesActualGeometry() {
        if (this._workspacesViews.length != Main.layoutManager.monitors.length)
            return;

        let [x, y] = this.actor.get_transformed_position();
        let allocation = this.actor.allocation;
        let width = allocation.x2 - allocation.x1;
        let height = allocation.y2 - allocation.y1;
        let primaryGeometry = {x: x, y: y, width: width, height: height};

        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            let geometry;
            if (i == this._primaryIndex) {
                geometry = primaryGeometry;
            } else if (Main.mmOverview && Main.mmOverview[i]) {
                geometry = Main.mmOverview[i].getWorkspacesActualGeometry();
            } else {
                geometry = monitors[i];
            }
            if (geometry) {
//                global.log("actualG i: "+i+" x: "+geometry.x+" y: "+geometry.y+" width: "+geometry.width+" height: "+geometry.height);
                this._workspacesViews[i].setActualGeometry(geometry);
            }
        }
    }
};
