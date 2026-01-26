sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/formatter"
], function (Controller, JSONModel, MessageToast, MessageBox, formatter) {
    "use strict";

    return Controller.extend("my.collectiq.controller.Detail", {
        formatter: formatter,

        onInit: function () {
            // Create view model for UI state
            var oViewModel = new JSONModel({
                busy: false
            });
            this.getView().setModel(oViewModel, "view");

            // Attach to route matched
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("detail").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            var sPayerId = oEvent.getParameter("arguments").PayerId;

            // Bind the view to the Payer with expanded associations
            var sPath = "/Payers('" + sPayerId + "')";

            this.getView().bindElement({
                path: sPath,
                parameters: {
                    $expand: "Invoices,outreachHistory"
                }
            });
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("main");
        },

        onGenerateOutreach: function () {
            var that = this;
            var oModel = this.getView().getModel();
            var oContext = this.getView().getBindingContext();

            if (!oContext) {
                MessageBox.error("No customer selected");
                return;
            }

            var sPayerId = oContext.getProperty("PayerId");

            // Call the service action
            var oActionBinding = oModel.bindContext("/generateOutreach(...)");
            oActionBinding.setParameter("PayerId", sPayerId);

            oActionBinding.execute().then(function () {
                var sMessage = oActionBinding.getBoundContext().getObject().value;
                MessageToast.show(sMessage || "Outreach generated");
                // Refresh the view
                that.getView().getElementBinding().refresh();
            }).catch(function (oError) {
                MessageBox.error("Error generating outreach: " + oError.message);
            });
        },

        onSendOutreach: function () {
            var that = this;
            var oModel = this.getView().getModel();
            var oContext = this.getView().getBindingContext();

            if (!oContext) {
                MessageBox.error("No customer selected");
                return;
            }

            var sPayerId = oContext.getProperty("PayerId");

            // Call the service action
            var oActionBinding = oModel.bindContext("/sendOutreach(...)");
            oActionBinding.setParameter("PayerId", sPayerId);

            oActionBinding.execute().then(function () {
                var sMessage = oActionBinding.getBoundContext().getObject().value;
                MessageToast.show(sMessage || "Outreach sent");
                // Refresh the view
                that.getView().getElementBinding().refresh();
            }).catch(function (oError) {
                MessageBox.error("Error sending outreach: " + oError.message);
            });
        }
    });
});
