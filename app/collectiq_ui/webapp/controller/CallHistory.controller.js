sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/routing/History",
    "../model/formatter"
], function (Controller, Filter, FilterOperator, History, formatter) {
    "use strict";

    return Controller.extend("my.collectiq.controller.CallHistory", {
        formatter: formatter,

        onInit: function () {
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.navTo("main", {}, true);
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query");
            if (!sQuery) {
                sQuery = oEvent.getParameter("newValue");
            }

            var aFilters = [];
            if (sQuery && sQuery.length > 0) {
                aFilters.push(new Filter("payer/PayerName", FilterOperator.Contains, sQuery));
            }

            var oTable = this.byId("callHistoryTable");
            var oBinding = oTable.getBinding("items");
            oBinding.filter(aFilters);
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem.getBindingContext();
            var sCallId = oContext.getProperty("callId");
            // Note: Our route expects 'callId' which is the explicit string ID field in CallTranscripts entity

            this.getOwnerComponent().getRouter().navTo("callResults", {
                callId: sCallId
            });
        }
    });
});
