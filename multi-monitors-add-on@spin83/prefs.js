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

const GObject = imports.gi.GObject;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const Gettext = imports.gettext.domain('multi-monitors-add-on');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_PANEL_ID = 'show-panel';
const SHOW_THUMBNAILS_SLIDER_ID = 'show-thumbnails-slider';
const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_APP_MENU_ID = 'show-app-menu';
const SHOW_DATE_TIME_ID = 'show-date-time';
const THUMBNAILS_ON_LEFT_SIDE_ID = 'thumbnails-on-left-side';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';

const Columns = {
    INDICATOR_NAME: 0,
    MONITOR_NUMBER: 1
};


const MultiMonitorsPrefsWidget = new GObject.Class({
    Name: 'MultiMonitorsPrefsWidget',
    Extends: Gtk.Grid,

    _init(params) {
		this.parent(params);
		
		this.set_orientation(Gtk.Orientation.VERTICAL);
		
		this._settings = Convenience.getSettings();
		
		this._screen = Gdk.Screen.get_default();
		
		this._addBooleanSwitch(_('Show Multi Monitors indicator on Top Panel.'), SHOW_INDICATOR_ID);
		this._addBooleanSwitch(_('Show Panel on additional monitors.'), SHOW_PANEL_ID);
		this._addBooleanSwitch(_('Show Thumbnails-Slider on additional monitors.'), SHOW_THUMBNAILS_SLIDER_ID);
		this._addBooleanSwitch(_('Show Activities-Button on additional monitors.'), SHOW_ACTIVITIES_ID);
		this._addBooleanSwitch(_('Show AppMenu-Button on additional monitors.'), SHOW_APP_MENU_ID);
		this._addBooleanSwitch(_('Show DateTime-Button on additional monitors.'), SHOW_DATE_TIME_ID);
		this._addBooleanSwitch(_('Show Thumbnails-Slider on left side of additional monitors.'), THUMBNAILS_ON_LEFT_SIDE_ID);
		
        this._store = new Gtk.ListStore();
        this._store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);	

		this._treeView = new Gtk.TreeView({ model: this._store, hexpand: true, vexpand: true });
		this._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        let appColumn = new Gtk.TreeViewColumn({ expand: true, sort_column_id: Columns.INDICATOR_NAME,
                                                 title: _("A list of indicators for transfer to additional monitors.") });

        let nameRenderer = new Gtk.CellRendererText;
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, "text", Columns.INDICATOR_NAME);
        
        nameRenderer = new Gtk.CellRendererText;
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, "text", Columns.MONITOR_NUMBER);
        
        this._treeView.append_column(appColumn);
        this.add(this._treeView);
        
        let toolbar = new Gtk.Toolbar();
        toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_INLINE_TOOLBAR);
        
        this._settings.connect('changed::'+TRANSFER_INDICATORS_ID, Lang.bind(this, this._updateIndicators));
        this._updateIndicators();
        
        let addTButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_ADD });
        addTButton.connect('clicked', Lang.bind(this, this._addIndicator));
        toolbar.add(addTButton);

        let removeTButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_REMOVE });
        removeTButton.connect('clicked', Lang.bind(this, this._removeIndicator));
        toolbar.add(removeTButton);
        
        this.add(toolbar);

    },
    
    _updateIndicators() {
    	this._store.clear();
    	
    	let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();

		for(let indicator in transfers) {
			if(transfers.hasOwnProperty(indicator)){
				let monitor = transfers[indicator];
	            let iter = this._store.append();
	            this._store.set(iter, [Columns.INDICATOR_NAME, Columns.MONITOR_NUMBER], [indicator, monitor]);
			}
		}
	},
    
    _addIndicator() {
	
    	let dialog = new Gtk.Dialog({ title: _("Select indicator"),
            									transient_for: this.get_toplevel(), modal: true });
    	dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
    	dialog.add_button(_("Add"), Gtk.ResponseType.OK);
    	dialog.set_default_response(Gtk.ResponseType.OK);

    	let grid = new Gtk.Grid({ column_spacing: 10, row_spacing: 15, margin: 10 });
    	
    	grid.set_orientation(Gtk.Orientation.VERTICAL);
    	
    	dialog._store = new Gtk.ListStore();
    	dialog._store.set_column_types([GObject.TYPE_STRING]);		

    	dialog._treeView = new Gtk.TreeView({ model: dialog._store, hexpand: true, vexpand: true });
    	dialog._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        let appColumn = new Gtk.TreeViewColumn({ expand: true, sort_column_id: Columns.INDICATOR_NAME,
                                                 title: _("Indicators on Top Panel") });
        
        let nameRenderer = new Gtk.CellRendererText;
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, "text", Columns.INDICATOR_NAME);        

        dialog._treeView.append_column(appColumn);
        
        let availableIndicators = () => {
        	let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).unpack();
    		dialog._store.clear();
    		this._settings.get_strv(AVAILABLE_INDICATORS_ID).forEach((indicator) => {
    			if(!transfers.hasOwnProperty(indicator)){
        			let iter = dialog._store.append();
        			dialog._store.set(iter, [Columns.INDICATOR_NAME], [indicator]);
    			}
    		});
        };
        
        let availableIndicatorsId = this._settings.connect('changed::'+AVAILABLE_INDICATORS_ID,
        													availableIndicators);
        let transferIndicatorsId = this._settings.connect('changed::'+TRANSFER_INDICATORS_ID,
															availableIndicators);
        
        availableIndicators.apply(this);
//    	grid.attach(dialog._treeView, 0, 0, 2, 1);
    	grid.add(dialog._treeView);
    	
		let gHBox = new Gtk.HBox({margin: 10, spacing: 20, hexpand: true});
		let gLabel = new Gtk.Label({label: _('Monitor index:'), halign: Gtk.Align.START});
		gHBox.add(gLabel);
		dialog._adjustment = new Gtk.Adjustment({lower: 0.0, upper: 0.0, step_increment:1.0});
		let spinButton = new Gtk.SpinButton({halign: Gtk.Align.END, adjustment: dialog._adjustment, numeric: 1});
		gHBox.add(spinButton);
		
		let monitorsChanged = () => {
			let n_monitors = this._screen.get_n_monitors() -1;
			dialog._adjustment.set_upper(n_monitors)
			dialog._adjustment.set_value(n_monitors);
		};
		
		let monitorsChangedId = this._screen.connect('monitors-changed', monitorsChanged);

		monitorsChanged.apply(this);
		grid.add(gHBox);
    	
    	dialog.get_content_area().add(grid);

    	dialog.connect('response', (dialog, id) => {
    		this._screen.disconnect(monitorsChangedId);
    		this._settings.disconnect(availableIndicatorsId);
    		this._settings.disconnect(transferIndicatorsId);
			if (id != Gtk.ResponseType.OK) {
				dialog.destroy();
				return;
			}
			
	        let [any, model, iter] = dialog._treeView.get_selection().get_selected();
	        if (any) {
	        	let indicator = model.get_value(iter, Columns.INDICATOR_NAME);
	        	
	        	let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
	        	if(!transfers.hasOwnProperty(indicator)){
	        		transfers[indicator] = dialog._adjustment.get_value();
	            	this._settings.set_value(TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
	        	}
	        }

			dialog.destroy();
		});
    	
		dialog.show_all();
    },
    
    _removeIndicator() {
        let [any, model, iter] = this._treeView.get_selection().get_selected();
        if (any) {
        	let indicator = model.get_value(iter, Columns.INDICATOR_NAME);
        	
        	let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
        	if(transfers.hasOwnProperty(indicator)){
        		delete transfers[indicator];
            	this._settings.set_value(TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
        	}
        }
    },

    _addBooleanSwitch(label, schema_id) {
		let gHBox = new Gtk.HBox({margin: 10, spacing: 20, hexpand: true});
		let gLabel = new Gtk.Label({label: _(label), halign: Gtk.Align.START});
		gHBox.add(gLabel);
		let gSwitch = new Gtk.Switch({halign: Gtk.Align.END});
		gHBox.add(gSwitch);
		this.add(gHBox);
		
		this._settings.bind(schema_id, gSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
	}
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let widget = new MultiMonitorsPrefsWidget();
    widget.show_all();

    return widget;
}
