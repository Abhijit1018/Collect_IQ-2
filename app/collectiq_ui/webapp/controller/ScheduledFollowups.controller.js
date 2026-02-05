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
            if (!this._oNewFollowupDialog) {
                this._oNewFollowupDialog = sap.ui.xmlfragment("my.collectiq.view.fragments.NewFollowupDialog", this);
                this.getView().addDependent(this._oNewFollowupDialog);
            }
            this._oNewFollowupDialog.open();
        },

        onCancelFollowup: function () {
            if (this._oNewFollowupDialog) {
                this._oNewFollowupDialog.close();
            }
        },

        onSaveFollowup: function () {
            const oPayerSelect = sap.ui.getCore().byId("payerSelect");
            const oDatePicker = sap.ui.getCore().byId("scheduledDate");
            const oReasonInput = sap.ui.getCore().byId("reason");

            const sPayerId = oPayerSelect.getSelectedKey();
            const sDate = oDatePicker.getValue(); // YYYY-MM-DD from valueFormat
            const sReason = oReasonInput.getValue();

            if (!sPayerId || !sDate || !sReason) {
                MessageToast.show("Please fill all required fields.");
                return;
            }

            const oModel = this.getView().getModel();
            const oEntry = oModel.createEntry("/ScheduledFollowups", {
                properties: {
                    payer_PayerId: sPayerId,
                    scheduledDate: sDate,
                    scheduledTime: new Date().toTimeString().split(' ')[0], // Current Local Time
                    reason: sReason,
                    status: 'pending'
                },
                success: () => {
                    MessageToast.show("Follow-up scheduled successfully.");
                    this.onCancelFollowup();
                    // Clear inputs
                    oPayerSelect.setSelectedKey(null);
                    oDatePicker.setValue(null);
                    oReasonInput.setValue("");
                },
                error: (oError) => {
                    MessageBox.error("Failed to schedule follow-up: " + oError.message);
                }
            });

            oModel.submitChanges();
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
