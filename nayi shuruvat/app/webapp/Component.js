sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function(UIComponent, JSONModel, Device) {
    "use strict";

    return UIComponent.extend("my.collectiq.Component", {
        metadata: {
            manifest: "json"
        },

        init: function() {
            // Call parent init
            UIComponent.prototype.init.apply(this, arguments);

            // Set device model
            var oDeviceModel = new JSONModel(Device);
            oDeviceModel.setDefaultBindingMode("OneWay");
            this.setModel(oDeviceModel, "device");

            // Initialize the router
            this.getRouter().initialize();
        },

        getContentDensityClass: function() {
            if (!this._sContentDensityClass) {
                if (!Device.support.touch) {
                    this._sContentDensityClass = "sapUiSizeCompact";
                } else {
                    this._sContentDensityClass = "sapUiSizeCozy";
                }
            }
            return this._sContentDensityClass;
        }
    });
});
