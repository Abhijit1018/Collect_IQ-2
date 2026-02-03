sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageToast, MessageBox, History) {
    "use strict";

    return Controller.extend("my.collectiq.controller.ScheduledFollowups", {

        onInit: function () {
            // Initialize view model
            const oViewModel = new JSONModel({
                viewMode: "list"
            });
            this.getView().setModel(oViewModel, "view");

            // Attach route match handler
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("followups").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            // Refresh the table binding
            const oTable = this.getView().byId("followupsTable");
            if (oTable) {
                const oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oBinding.refresh();
                }
            }
        },

        formatStatusState: function (status) {
            const statusMap = {
                "pending": "Warning",
                "completed": "Success",
                "cancelled": "Error",
                "failed": "Error",
                "rescheduled": "Information"
            };
            return statusMap[status] || "None";
        },

        onFollowUpSelect: function (oEvent) {
            const oItem = oEvent.getParameter("listItem");
            const oContext = oItem.getBindingContext();

            // Navigate to detail view or show details
            MessageToast.show("Follow-up selected: " + oContext.getProperty("ID"));
        },

        onScheduleNew: function () {
            // TODO: Open dialog to create new follow-up
            MessageToast.show("Functionality coming soon: Schedule new follow-up dialog");
        },

        onCancel: function (oEvent) {
            const oItem = oEvent.getSource().getParent().getParent();
            const oContext = oItem.getBindingContext();
            const sFollowUpId = oContext.getProperty("ID");

            MessageBox.confirm("Are you sure you want to cancel this follow-up?", {
                onClose: (sAction) => {
                    if (sAction === MessageBox.Action.OK) {
                        this.cancelFollowUp(sFollowUpId);
                    }
                }
            });
        },

        cancelFollowUp: function (sFollowUpId) {
            const oModel = this.getOwnerComponent().getModel();
            const oContextBinding = oModel.bindContext("/cancelFollowUp(...)");
            oContextBinding.setParameter("followUpId", sFollowUpId);

            oContextBinding.execute().then(() => {
                MessageToast.show("Follow-up cancelled");
                this.getView().byId("followupsTable").getBinding("items").refresh();
            }).catch((oError) => {
                // Parse error message if available
                MessageToast.show("Error cancelling follow-up");
                console.error(oError);
            });
        },

        onNavBack: function () {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("main", {}, true);
            }
        }
    });
});
