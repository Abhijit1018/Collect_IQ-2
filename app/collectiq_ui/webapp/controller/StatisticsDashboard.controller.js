sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageToast, History) {
    "use strict";

    return Controller.extend("my.collectiq.controller.StatisticsDashboard", {

        onInit: function () {
            // Initialize models
            this.getView().setModel(new JSONModel({}), "stats");
            this.getView().setModel(new JSONModel([]), "timeline");
            this.getView().setModel(new JSONModel([]), "paymentDist");
            this.getView().setModel(new JSONModel([]), "aging");

            // Attach route match handler to refresh data on navigation
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);

            // Set up auto-refresh (every 5 minutes)
            setInterval(() => {
                this.loadAllStatistics();
            }, 300000);
        },

        _onRouteMatched: function () {
            // Refresh all statistics whenever the view is navigated to
            this.loadAllStatistics();
        },

        loadAllStatistics: function () {
            this.loadOverviewStats();
            this.loadOutreachTimeline();
            this.loadPaymentDistribution();
            this.loadAgingAnalysis();
        },

        loadOverviewStats: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getOverviewStats(...)");

            oCreateContext.execute().then(() => {
                const oData = oCreateContext.getBoundContext().getObject();
                this.getView().getModel("stats").setData(oData);
            }).catch((oError) => {
                MessageToast.show("Error loading statistics");
                console.error(oError);
            });
        },

        loadOutreachTimeline: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getOutreachTimeline(...)");
            oCreateContext.setParameter("days", 30);

            oCreateContext.execute().then(() => {
                const oContext = oCreateContext.getBoundContext();
                const oData = oContext.getObject();
                const results = oData.value || (Array.isArray(oData) ? oData : []);
                console.log(">>> [DASHBOARD] Raw Timeline Data:", results); // Debug Log
                const timelineData = this.transformTimelineData(results);
                this.getView().getModel("timeline").setData(timelineData);
            }).catch((oError) => {
                console.error(oError);
            });
        },

        transformTimelineData: function (data) {
            // Group by date and pivot outreach types
            const grouped = {};

            data.forEach(item => {
                const dateKey = item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date;
                if (!grouped[dateKey]) {
                    grouped[dateKey] = {
                        date: dateKey,
                        email: 0,
                        call: 0,
                        sms: 0
                    };
                }
                const type = (item.outreachType || '').toLowerCase();
                if (grouped[dateKey][type] !== undefined) {
                    grouped[dateKey][type] = item.count;
                }
            });

            return Object.values(grouped);
        },

        loadPaymentDistribution: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getPaymentDistribution(...)");

            oCreateContext.execute().then(() => {
                const oData = oCreateContext.getBoundContext().getObject();
                const results = oData.value || (Array.isArray(oData) ? oData : []);
                this.getView().getModel("paymentDist").setData(results);
            }).catch((oError) => {
                console.error(oError);
            });
        },

        loadAgingAnalysis: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getAgingAnalysis(...)");

            oCreateContext.execute().then(() => {
                const oData = oCreateContext.getBoundContext().getObject();
                const results = oData.value || (Array.isArray(oData) ? oData : []);
                this.getView().getModel("aging").setData(results);
            }).catch((oError) => {
                console.error(oError);
            });
        },

        onNavToFollowups: function () {
            var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
            oRouter.navTo("followups");
        },

        onNavToCallHistory: function () {
            var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
            oRouter.navTo("callHistory");
        },

        onNavToCustomers: function () {
            var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
            oRouter.navTo("main");
        },

        onNavToShadowMode: function () {
            var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
            oRouter.navTo("shadowMode");
        },

        onCardPress: function (oEvent) {
            // Navigate to detailed view if needed
            MessageToast.show("Card pressed");
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
                // Nav back to home (which is now dashboard, but if we are ON dashboard, this is moot)
                // Leaving for safety
                oRouter.navTo("dashboard", {}, true);
            }
        }
    });
});
