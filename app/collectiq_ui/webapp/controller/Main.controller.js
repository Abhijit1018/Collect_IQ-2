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
            this._applyFilters(sQuery, this.byId("stageFilter").getSelectedKey());
        },

        onFilter: function (oEvent) {
            var sKey = oEvent.getParameter("selectedItem").getKey();
            var sQuery = this.byId("searchField").getValue();
            this._applyFilters(sQuery, sKey);
        },

        _applyFilters: function (sQuery, sStageKey) {
            var oTable = this.byId("customerTable");
            var oBinding = oTable.getBinding("items");
            var aFilters = [];

            // Search Filter - case-insensitive
            if (sQuery) {
                var sLowerQuery = sQuery.toLowerCase();
                aFilters.push(new Filter({
                    filters: [
                        new Filter({
                            path: "PayerName",
                            operator: FilterOperator.Contains,
                            value1: sQuery,
                            caseSensitive: false
                        }),
                        new Filter({
                            path: "PayerId",
                            operator: FilterOperator.Contains,
                            value1: sQuery,
                            caseSensitive: false
                        }),
                        new Filter({
                            path: "ContactEmail",
                            operator: FilterOperator.Contains,
                            value1: sQuery,
                            caseSensitive: false
                        })
                    ],
                    and: false
                }));
            }

            // Stage Filter
            if (sStageKey && sStageKey !== "ALL") {
                aFilters.push(new Filter("Stage", FilterOperator.EQ, sStageKey));
            }

            // Combine filters if there are any
            if (aFilters.length > 0) {
                // If both search and filter are present, we need to AND them.
                // The Search filter is an OR group, so it's one filter object.
                // The Stage filter is another filter object.
                // By default oBinding.filter(aFilters) ANDs the top-level array.
                oBinding.filter(aFilters);
            } else {
                oBinding.filter([]);
            }
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

        onNavToDashboard: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard");
        },

        onNavToFollowups: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("followups");
        },

        onNavToCallHistory: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("callHistory");
        },

        onExportPayers: function () {
            var oTable = this.byId("customerTable");
            var aItems = oTable.getItems();
            var aRows = [];

            // Header
            aRows.push(["Payer ID", "Name", "Total Past Due", "Max Days Past Due", "Stage", "Contact Email"].join(","));

            // Data
            aItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (oContext) {
                    var oObj = oContext.getObject();
                    var aRow = [
                        oObj.PayerId,
                        '"' + (oObj.PayerName || "").replace(/"/g, '""') + '"', // Escape quotes
                        oObj.TotalPastDue,
                        oObj.MaxDaysPastDue,
                        oObj.Stage,
                        oObj.ContactEmail
                    ];
                    aRows.push(aRow.join(","));
                }
            });

            var sContent = aRows.join("\n");
            var sFileName = "Customer_List.csv";

            // Trigger Download
            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(sContent));
            element.setAttribute('download', sFileName);
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);
        },

        onGenerateOutreachAll: function () {
            var that = this;
            var oTable = this.byId("customerTable");
            var aSelectedItems = oTable.getSelectedItems();

            if (aSelectedItems.length === 0) {
                MessageBox.warning("Please select at least one customer to generate outreach.");
                return;
            }

            var oModel = this.getView().getModel();
            var aPromises = [];

            aSelectedItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                var sPath = oContext.getPath();
                var oActionBinding = oModel.bindContext(sPath + "/CollectIQService.generateOutreach(...)");
                aPromises.push(oActionBinding.execute());
            });

            Promise.all(aPromises).then(function () {
                MessageToast.show("Outreach generated for " + aSelectedItems.length + " customer(s)");
                that.byId("customerTable").getBinding("items").refresh();
                oTable.removeSelections();
            }).catch(function (oError) {
                MessageBox.error("Error generating outreach: " + oError.message);
            });
        },

        onSendOutreachAll: function () {
            var that = this;
            var oTable = this.byId("customerTable");
            var aSelectedItems = oTable.getSelectedItems();

            if (aSelectedItems.length === 0) {
                MessageBox.warning("Please select at least one customer to send outreach.");
                return;
            }

            var oModel = this.getView().getModel();
            var aPromises = [];

            aSelectedItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                var sPath = oContext.getPath();
                var oActionBinding = oModel.bindContext(sPath + "/CollectIQService.sendOutreach(...)");
                aPromises.push(oActionBinding.execute());
            });

            Promise.all(aPromises).then(function () {
                MessageToast.show("Outreach sent to " + aSelectedItems.length + " customer(s)");
                that.byId("customerTable").getBinding("items").refresh();
                oTable.removeSelections();
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

            // First generate, then send (Bound Actions - Absolute Path)
            var sPath = oContext.getPath();
            var oGenBinding = oModel.bindContext(sPath + "/CollectIQService.generateOutreach(...)");

            oGenBinding.execute().then(function () {
                var oSendBinding = oModel.bindContext(sPath + "/CollectIQService.sendOutreach(...)");
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
