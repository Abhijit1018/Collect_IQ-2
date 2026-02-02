sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/formatter",
    "sap/ui/core/Fragment"
], function (Controller, JSONModel, MessageToast, MessageBox, formatter, Fragment) {
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

        onAddInvoice: function () {
            var oView = this.getView();

            // create dialog lazily
            if (!this._pDialog) {
                this._pDialog = Fragment.load({
                    id: oView.getId(),
                    name: "my.collectiq.view.fragments.AddInvoice",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onCancelInvoice: function () {
            this.byId("invoiceNumberInput").setValue("");
            this.byId("invoiceAmountInput").setValue("");
            this.byId("invoiceDueDateInput").setValue("");
            this._pDialog.then(function (oDialog) {
                oDialog.close();
            });
        },

        onSubmitInvoice: function () {
            var sInvoiceNumber = this.byId("invoiceNumberInput").getValue();
            var sAmount = this.byId("invoiceAmountInput").getValue();
            var sDueDate = this.byId("invoiceDueDateInput").getDateValue(); // Returns Date object

            if (!sInvoiceNumber || !sAmount || !sDueDate) {
                MessageBox.error("Please fill all required fields.");
                return;
            }

            var oContext = this.getView().getBindingContext();
            var sPayerId = oContext.getProperty("PayerId");

            // Format Date for V4 (YYYY-MM-DD)
            var sDateString = sDueDate.toISOString().split('T')[0];

            var oEntry = {
                InvoiceId: crypto.randomUUID(), // V4 often needs ID client-side or we rely on server
                PayerId: sPayerId,
                InvoiceNumber: sInvoiceNumber,
                InvoiceAmount: parseFloat(sAmount),
                Currency: "USD", // Simplification
                DueDate: sDateString,
                DaysPastDue: 0 // Default
            };

            // Get the list binding of the Invoices table
            var oTable = this.byId("invoicesTable");
            var oBinding = oTable.getBinding("items");

            var oContext = oBinding.create(oEntry);

            var that = this;
            oContext.created().then(function () {
                MessageToast.show("Invoice Created Successfully");
                that.onCancelInvoice();
            }).catch(function (oError) {
                MessageBox.error("Error creating invoice: " + oError.message);
            });
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

            // Call the bound service action (Absolute Path Construction)
            var sPath = oContext.getPath();
            var oActionBinding = oModel.bindContext(sPath + "/CollectIQService.generateOutreach(...)");
            // No parameter needed: bound action uses the context's ID

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

            // Call the bound service action (Absolute Path Construction)
            var sPath = oContext.getPath();
            var oActionBinding = oModel.bindContext(sPath + "/CollectIQService.sendOutreach(...)");
            // No parameter needed: bound action uses the context's ID

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
