const MapStorage = require( './storage.js' ),
    MarkerLayerManager = require( './layerManager.js' ),
    MarkerPopup = require( './popup.js' ),
    MapLegend = require( './legend.js' ),
    MarkerLegendPanel = require( './markerLegend.js' ),
    config = require( './config.json' ),
    mwApi = new mw.Api();


const CRSOrigin = {
    TopLeft: 1,
    BottomLeft: 2
};


function DataMap( id, $root, config ) {
    this.id = id;
    // Root DOM element of the data map
    this.$root = $root;
    // Setup configuration
    this.config = config;
    // Local storage driver
    this.storage = new MapStorage( this );
    // Layering driver
    this.layerManager = new MarkerLayerManager( this );
    // Information of currently set background
    this.background = null;
    this.backgroundIndex = 0;
    // Data set filters
    this.dataSetFilters = this.$root.data( 'filter-groups' ) || null;
    if (this.dataSetFilters) {
        this.dataSetFilters = this.dataSetFilters.split( '|' );
    }
    //
    this.$status = $root.find( '.datamap-status' );
    // MapLegend instance
    this.legend = null;
    // Leaflet.Map instance
    this.leaflet = null;
    // Collection of Leaflet.Icons by group
    this.leafletIcons = {};
    // DOM element of the coordinates display control
    this.$coordTracker = null;
    // Collection of group visibility toggles
    this.legendGroupToggles = [];
    // Cached value of the 'datamap-coordinate-control-text' message
    this.coordTrackingMsg = mw.msg( 'datamap-coordinate-control-text' );
    // Retrieve a `marker` parameter from the query string if one is present
    this.markerIdToAutoOpen = new URLSearchParams( window.location.search ).get( MarkerPopup.URL_PARAMETER );

    // Coordinate reference system
    // If coordinate space spec is oriented [ lower lower upper upper ], assume top left corner as origin point (latitude will
    // be flipped). If [ upper upper lower lower ], assume bottom left corner (latitude will be unchanged). Any other layout is
    // invalid.
    this.crsOrigin = ( this.config.crs[0][0] < this.config.crs[1][0] && this.config.crs[0][1] < this.config.crs[1][1] )
        ? CRSOrigin.TopLeft : CRSOrigin.BottomLeft;
    this.crsScaleY = 100 / Math.max( this.config.crs[0][0], this.config.crs[1][0] );
    this.crsScaleX = 100 / Math.max( this.config.crs[0][1], this.config.crs[1][1] );

    // Request OOUI to be loaded and build the legend
    mw.loader.using( [
        'oojs-ui-core',
        'oojs-ui-widgets',
        'ext.ark.datamaps.icons'
    ], buildLegend.bind( this ) );
    // Prepare the Leaflet map view
    mw.loader.using( [
        'ext.ark.datamaps.leaflet.core',
        'ext.ark.datamaps.leaflet.extra'
    ], buildLeafletMap.bind( this, this.$root.find( '.datamap-holder' ) ) );
}


/*
 * Runs the callback function when the Leaflet map is initialised. This is required if a function/gadget depends on any
 * Leaflet code (global L) having been loaded.
 */
DataMap.prototype.waitForLeaflet = function ( callback ) {
    if ( this.leaflet == null ) {
        setTimeout( this.waitForLeaflet.bind( this, callback ), 25 );
    } else {
        callback();
    }
};


/*
 * Returns true if a layer is used on the map.
 */
DataMap.prototype.isLayerUsed = function ( name ) {
    return this.config.layerIds.indexOf( name ) >= 0;
};


/*
 * 
 */
DataMap.prototype.translatePoint = function ( point ) {
    return this.crsOrigin == CRSOrigin.TopLeft
        ? [ ( this.config.crs[1][0] - point[0] ) * this.crsScaleY, point[1] * this.crsScaleX ]
        : [ point[0] * this.crsScaleY, point[1] * this.crsScaleX ];
};


DataMap.prototype.translateBox = function ( box ) {
    return this.crsOrigin == CRSOrigin.TopLeft
        ? [ [ ( this.config.crs[1][0] - box[0][0] ) * this.crsScaleY, box[0][1] * this.crsScaleX ],
            [ ( this.config.crs[1][0] - box[1][0] ) * this.crsScaleY, box[1][1] * this.crsScaleX ] ]
        : [ [ box[0][0] * this.crsScaleY, box[0][1] * this.crsScaleX ],
            [ box[1][0] * this.crsScaleY, box[1][0] * this.crsScaleX ] ];
};


/*
 * Returns a formatted datamap-coordinate-control-text message.
 */
DataMap.prototype.getCoordLabel = function ( lat, lon ) {
    return this.coordTrackingMsg.replace( '$1', lat.toFixed( 2 ) ).replace( '$2', lon.toFixed( 2 ) );
};


/*
 * Called whenever a marker is instantiated
 */
DataMap.prototype.onMarkerReady = function ( type, group, instance, marker ) {
    // Open this marker's popup if that's been requested via a `marker` query parameter
    if ( this.markerIdToAutoOpen != null
        && ( ( instance[2] && instance[2].uid != null ) ? instance[2].uid : this.storage.getMarkerKey( type, instance ) )
            === this.markerIdToAutoOpen ) {
        marker.openPopup();
    }
};


/*
 * Builds markers from a data object
 */
DataMap.prototype.instantiateMarkers = function ( data ) {
    // Register all layers in this package
    for ( const markerType in data ) {
        markerType.split( ' ' ).forEach( name => this.layerManager.register( name ) );
    }
    
    // Unpack markers
    for ( const markerType in data ) {
        const layers = markerType.split( ' ' );
        const groupName = layers[0];
        const group = this.config.groups[groupName];
        const placements = data[markerType];

        // Create markers for instances
        placements.forEach( instance => {
            const position = this.translatePoint( [ instance[0], instance[1] ] );
            let leafletMarker;

            // Construct the marker
            if ( group.markerIcon ) {
                // Fancy icon marker
                leafletMarker = new L.Ark.IconMarker( position, {
                    icon: this.leafletIcons[groupName],
                    dismissed: group.canDismiss ? this.storage.isDismissed( markerType, instance ) : false
                } );
            } else {
                // Circular marker
                leafletMarker = new L.Ark.CircleMarker( position, {
                    baseRadius: group.size/2,
                    expandZoomInvEx: group.extraMinZoomSize,
                    fillColor: group.fillColor,
                    fillOpacity: 0.7,
                    color: group.strokeColor || group.fillColor,
                    weight: group.strokeWidth || 1,
                } );
            }

            // Add marker to the layer
            this.layerManager.addMember( markerType, leafletMarker );

            // Bind a popup building closure (this is more efficient than binds)
            const mType = markerType;
            leafletMarker.bindPopup( () =>
                new MarkerPopup( this, mType, instance, ( instance[2] || {} ), leafletMarker ).build().get( 0 ) );
            leafletMarker.on( 'popupopen', () => {
                MarkerPopup.updateLocation( ( instance[2] && instance[2].uid != null ) ? instance[2].uid
                    : this.storage.getMarkerKey( mType, instance ) );
            } );
            leafletMarker.on( 'popupclose', () => {
                MarkerPopup.updateLocation( null );
            } );

            this.onMarkerReady( markerType, group, instance, leafletMarker );
        } );
    }
};


DataMap.prototype.streamMarkersIn = function ( pageName, version, filter, successCallback, errorCallback ) {
    const query = {
        action: 'queryDataMap',
        title: pageName
    };
    if ( version ) {
        query.revid = version;
    }
    if ( filter ) {
        query.filter = filter.join( '|' );
    }
    return mwApi.get( query ).then(
        data => {
            if ( data.error )
                errorCallback();
            else
                this.waitForLeaflet( () => {
                    this.instantiateMarkers( data.query.markers );
                    successCallback();
                } );
        },
        errorCallback
    );
};


/*
 * 
 */
DataMap.prototype.setCurrentBackground = function ( index ) {
    // Remove existing layers off the map
    if ( this.background ) {
        this.background.layers.forEach( x => x.remove() );
        this.background = null;
    }

    // Check if index is valid, and fall back to first otherwise
    if ( index < 0 || index >= this.config.backgrounds.length ) {
        index = 0;
    }

    // Update state
    this.background = this.config.backgrounds[ index ];
    this.backgroundIndex = index;

    // Push layers back onto the map
    this.background.layers.forEach( x => {
        x.addTo( this.leaflet );
        x.bringToBack();
    } );
};


DataMap.prototype.updateMarkerScaling = function () {
    const zoom = this.leaflet.getZoom();
    this.leaflet.options.markerScaleI = zoom / this.leaflet.options.minZoom;
    this.leaflet.options.markerScaleA = zoom / this.leaflet.options.maxZoom;
};


DataMap.prototype.restoreDefaultView = function () {
    this.leaflet.setZoom( this.leaflet.options.minZoom );
    this.leaflet.fitBounds( this.translateBox( this.background.at ) );
};


DataMap.prototype.centreView = function () {
    const box = this.translateBox( this.background.at );
    this.leaflet.setView( [ (box[1][0] + box[0][0])/2, (box[1][1] + box[0][1])/2 ] );
};


DataMap.prototype.anchors = {
    bottomLeft: '.leaflet-bottom.leaflet-left',
    topRight: '.leaflet-top.leaflet-right',
    topLeft: '.leaflet-top.leaflet-left'
};


DataMap.prototype.addControl = function ( anchor, $element ) {
    this.$root.find( `.leaflet-control-container ${anchor}` ).append( $element );
    return $element;
};


DataMap.prototype.buildBackgroundOverlayObject = function ( overlay ) {
    let result;

    // Construct an image or rectangular layer
    if ( overlay.image ) {
        result = L.imageOverlay( overlay.image, this.translateBox( overlay.at ) );
    } else if ( overlay.path ) {
        result = L.polyline( overlay.path.map( p => this.translatePoint( p ) ) );
    } else {
        result = L.rectangle( this.translateBox( overlay.at ), {
            fillOpacity: 0.05
        } );
    }

    // Bind name as tooltip
    if ( overlay.name ) {
        result.bindTooltip( overlay.name );
    }

    return result;
};


const buildLeafletMap = function ( $holder ) {
    const leafletConfig = $.extend( true, {
        // Boundaries
        center: [ 50, 50 ],
        maxBounds: [ [ -85, -85 ], [ 185, 185 ] ],
        maxBoundsViscosity: 0.7,
        // Zoom settings
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        maxZoom: 5,
        wheelPxPerZoomLevel: 240,
        minZoom: L.Browser.mobile ? ( L.Browser.retina ? 1 : 1.75 ) : 2,
        // Zoom animation causes some awkward locking as Leaflet waits for the animation to finish before processing more zoom
        // requests, but disabling it causes some updates to be distorted (for example, the canvas renderer will drift).
        // We include a patch in our Leaflet builds to disable animations on desktop-style zooms.
        zoomAnimation: true,
        markerZoomAnimation: true,
        // Do not allow pinch-zooming to surpass max zoom even temporarily. This seems to cause a mispositioning.
        bounceAtZoomLimits: false,
        // Pan settings
        inertia: false,
        // Zoom-based marker scaling
        shouldExpandZoomInvEx: true,
        expandZoomInvEx: 1.8,
        // Canvas renderer settings - using canvas for performance with padding of 1/3rd (to draw some more markers outside of
        // view for panning UX)
        preferCanvas: true,
        rendererSettings: {
            padding: 1/3
        },
    }, this.config.leafletSettings );
    // Specify the coordinate reference system and initialise the renderer
    leafletConfig.crs = L.CRS.Simple;
    leafletConfig.renderer = L.canvas( leafletConfig.rendererSettings );

    this.leaflet = L.map( $holder.get( 0 ), leafletConfig );

    // Prepare all backgrounds
    this.config.backgrounds.forEach( background => {
        background.layers = [];

        // Image overlay:
        // Latitude needs to be flipped as directions differ between Leaflet and ARK
        background.at = background.at || this.config.crs;
        background.layers.push( L.imageOverlay( background.image, this.translateBox( background.at ) ) );

        // Prepare overlay layers
        if ( background.overlays ) {
            background.overlays.forEach( overlay => background.layers.push( this.buildBackgroundOverlayObject( overlay ) ) );
        }
    } );
    // Switch to the last chosen one or first defined
    this.setCurrentBackground( this.storage.get( 'background' ) || 0 );
    // Restore default view
    this.restoreDefaultView();

    for ( const groupName in this.config.groups ) {
        const group = this.config.groups[groupName];

        // Register with the layer manager
        this.layerManager.register( groupName );

        if ( group.markerIcon ) {
            // Prepare the icon objects for Leaflet markers
            this.leafletIcons[groupName] = L.icon( { iconUrl: group.markerIcon, iconSize: group.size } );
        }
    }

    // Recalculate marker sizes when zoom ends
    this.leaflet.on( 'zoom', () => this.updateMarkerScaling() );
    this.updateMarkerScaling();

    // Create a coordinate-under-cursor display
    if ( config.DataMapsShowCoordinatesDefault ) {
        this.$coordTracker = this.addControl( this.anchors.bottomLeft, $( '<div class="leaflet-control datamap-control-coords">' ) );
        this.leaflet.on( 'mousemove', event => {
            let lat = event.latlng.lat;
            let lon = event.latlng.lng;
            if ( lat >= -5 && lat <= 105 && lon >= -5 && lon <= 105 ) {
                lat /= this.crsScaleY;
                lon /= this.crsScaleX;
                if ( this.crsOrigin == CRSOrigin.TopLeft )
                    lat = this.config.crs[1][0] - lat;
                this.$coordTracker.text( this.getCoordLabel( lat, lon ) );
            }
        } );
    }

    // Create a background toggle
    if ( this.config.backgrounds.length > 1 ) {
        this.$backgroundSwitch = this.addControl( this.anchors.topRight,
            $( '<select class="leaflet-control datamap-control-backgrounds leaflet-bar">' )
            .on( 'change', () => {
                this.setCurrentBackground( this.$backgroundSwitch.val() );
                // Remember the choice
                this.storage.set( 'background', this.$backgroundSwitch.val() );
            } )
        );
        this.config.backgrounds.forEach( ( background, index ) => {
            $( '<option>' ).attr( 'value', index ).text( background.name ).appendTo( this.$backgroundSwitch );
        } );
        this.$backgroundSwitch.val( this.backgroundIndex );
    }

    // Extend zoom control to add buttons to reset or centre the view
    const $viewControls = this.addControl( this.anchors.topLeft,
        $( '<div class="leaflet-control leaflet-bar datamap-control-viewcontrols">' ) );
    $viewControls.append(
        $( '<a role="button" class="datamap-control-viewreset oo-ui-icon-fullScreen" aria-disabled="false"></a>' )
        .attr( {
            title: mw.msg( 'datamap-control-reset-view' ),
            'aria-label': mw.msg( 'datamap-control-reset-view' )
        } )
        .on( 'click', () => this.restoreDefaultView() )
    );
    $viewControls.append(
        $( '<a role="button" class="datamap-control-viewcentre oo-ui-icon-exitFullscreen" aria-disabled="false"></a>' )
        .attr( {
            title: mw.msg( 'datamap-control-centre-view' ),
            'aria-label': mw.msg( 'datamap-control-centre-view' )
        } )
        .on( 'click', () => this.centreView() )
    );
};


const buildLegend = function () {
    // Determine if we'll need a layer dropdown
    const hasCaves = this.isLayerUsed( 'cave' );
    const withLayerDropdown = hasCaves;

    // Initialise legend objects
    this.legend = new MapLegend( this );
    this.markerLegend = new MarkerLegendPanel( this.legend, mw.msg( 'datamap-legend-tab-locations' ), true, withLayerDropdown );

    // Build the surface and caves toggle
    if ( hasCaves ) {
        this.markerLegend.addMarkerLayerToggleRequired( this.markerLegend.$layersPopup, 'cave', mw.msg( 'datamap-layer-surface' ) );
        this.markerLegend.addMarkerLayerToggleExclusive( this.markerLegend.$layersPopup, 'cave', mw.msg( 'datamap-layer-cave' ) );
    }

    // Build individual group toggles
    for ( const groupId in this.config.groups ) {
        if ( !this.dataSetFilters || this.dataSetFilters.indexOf( groupId ) >= 0 ) {
            this.markerLegend.addMarkerGroupToggle( groupId, this.config.groups[groupId] );
        }
    }

    mw.hook( `ext.ark.datamaps.afterLegendInitialisation.${this.id}` ).fire( this );
};


module.exports = DataMap;