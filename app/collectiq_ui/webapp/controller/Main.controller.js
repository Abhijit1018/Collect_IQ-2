sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/formatter"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, formatter) {
    "use strict";

    return Controller.extend("my.collectiq.controller.Main", {
        formatter: formatter,

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false
            });
            this.getView().setModel(oViewModel, "view");
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            var oTable = this.byId("customerTable");
            var oBinding = oTable.getBinding("items");

            var aFilters = [];
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PayerName", FilterOperator.Contains, sQuery),
                        new Filter("PayerId", FilterOperator.Contains, sQuery),
                        new Filter("ContactEmail", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters);
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem.getBindingContext();
            if (!oContext) {
                oContext = oEvent.getParameter("listItem");
                if (oContext) {
                    oContext = oContext.getBindingContext();
                }
            }
            if (!oContext) {
                console.error("No binding context found for item");
                return;
            }
            var sPayerId = oContext.getProperty("PayerId");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("detail", {
                PayerId: sPayerId
            });
        },

        onGenerateOutreachAll: function () {
            var that = this;
            var oModel = this.getView().getModel();

            var oActionBinding = oModel.bindContext("/generateOutreachForAll(...)");

            oActionBinding.execute().then(function () {
                var sMessage = oActionBinding.getBoundContext().getObject().value;
                MessageToast.show(sMessage || "Outreach generated for all customers");
                that.byId("customerTable").getBinding("items").refresh();
            }).catch(function (oError) {
                MessageBox.error("Error generating outreach: " + oError.message);
            });
        },

        onSendOutreachAll: function () {
            var that = this;
            var oModel = this.getView().getModel();

            var oActionBinding = oModel.bindContext("/sendOutreachToAll(...)");

            oActionBinding.execute().then(function () {
                var sMessage = oActionBinding.getBoundContext().getObject().value;
                MessageToast.show(sMessage || "Outreach sent to all customers");
                that.byId("customerTable").getBinding("items").refresh();
            }).catch(function (oError) {
                MessageBox.error("Error sending outreach: " + oError.message);
            });
        },

        onQuickSendOutreach: function (oEvent) {
            var that = this;
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext();

            if (!oContext) {
                MessageBox.error("No customer context found");
                return;
            }

            var sPayerId = oContext.getProperty("PayerId");
            var sPayerName = oContext.getProperty("PayerName");
            var oModel = this.getView().getModel();

            // First generate, then send
            var oGenBinding = oModel.bindContext("/generateOutreach(...)");
            oGenBinding.setParameter("PayerId", sPayerId);

            oGenBinding.execute().then(function () {
                var oSendBinding = oModel.bindContext("/sendOutreach(...)");
                oSendBinding.setParameter("PayerId", sPayerId);

                return oSendBinding.execute();
            }).then(function () {
                MessageToast.show("Outreach sent to " + sPayerName);
                that.byId("customerTable").getBinding("items").refresh();
            }).catch(function (oError) {
                MessageBox.error("Error: " + oError.message);
            });
        },

        onQuickCall: function (oEvent) {
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext();

            if (!oContext) {
                return;
            }

            var sPhone = oContext.getProperty("ContactPhone");
            var sPayerName = oContext.getProperty("PayerName");

            if (sPhone) {
                window.open("tel:" + sPhone, "_self");
                MessageToast.show("Calling " + sPayerName + " at " + sPhone);
            } else {
                MessageToast.show("No phone number available for " + sPayerName);
            }
        }
    });
});
