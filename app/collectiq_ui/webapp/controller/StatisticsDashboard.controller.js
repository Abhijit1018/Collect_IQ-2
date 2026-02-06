sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History",
    "sap/viz/ui5/format/ChartFormatter",
    "sap/viz/ui5/api/env/Format"
], function (Controller, JSONModel, MessageToast, MessageBox, History, ChartFormatter, Format) {
    "use strict";

    return Controller.extend("my.collectiq.controller.StatisticsDashboard", {

        onInit: function () {
            // Initialize all models
            this.getView().setModel(new JSONModel({
                totalPayers: 0,
                totalOutstanding: 0,
                totalOutstandingFormatted: "0",
                callsToday: 0,
                emailsToday: 0,
                smsToday: 0,
                successRate: 0,
                pendingFollowups: 0,
                promisesMade: 0,
                disputesRaised: 0,
                avgSentiment: "N/A",
                avgSentimentValue: 0,
                lastUpdated: "",
                totalRecords: 0
            }), "stats");
            
            this.getView().setModel(new JSONModel([]), "timeline");
            this.getView().setModel(new JSONModel([]), "paymentDist");
            this.getView().setModel(new JSONModel([]), "aging");
            this.getView().setModel(new JSONModel([]), "stageDist");
            this.getView().setModel(new JSONModel([]), "sentiment");
            this.getView().setModel(new JSONModel([]), "callOutcomes");
            this.getView().setModel(new JSONModel([]), "topPayers");
            this.getView().setModel(new JSONModel([]), "activity");

            // Attach route match handler
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);

            // Set up auto-refresh (every 5 minutes)
            this._refreshInterval = setInterval(() => {
                this.loadAllStatistics();
            }, 300000);
        },

        onExit: function () {
            if (this._refreshInterval) {
                clearInterval(this._refreshInterval);
            }
        },

        _onRouteMatched: function () {
            this.loadAllStatistics();
            this._initChartFormatters();
        },

        _initChartFormatters: function () {
            // Initialize chart formatters for better visuals
            Format.numericFormatter(ChartFormatter.getInstance());
            
            // Configure viz charts with better styling
            this._configureCharts();
        },

        _configureCharts: function () {
            const oView = this.getView();
            
            // Timeline chart configuration
            const oTimelineChart = oView.byId("outreachTimelineChart");
            if (oTimelineChart) {
                oTimelineChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#5899DA", "#E8743B", "#19A979"],
                        dataLabel: { visible: false },
                        window: { start: "firstDataPoint", end: "lastDataPoint" }
                    },
                    legend: { visible: true, position: "bottom" },
                    title: { visible: false },
                    interaction: { selectability: { mode: "EXCLUSIVE" } }
                });
            }

            // Stage distribution chart
            const oStageChart = oView.byId("stageDistChart");
            if (oStageChart) {
                oStageChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#19A979", "#E8743B", "#ED4A7B"],
                        dataLabel: { visible: true, type: "percentage" }
                    },
                    legend: { visible: true, position: "right" },
                    title: { visible: false }
                });
            }

            // Stage amount chart
            const oStageAmountChart = oView.byId("stageAmountChart");
            if (oStageAmountChart) {
                oStageAmountChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#19A979", "#E8743B", "#ED4A7B"],
                        dataLabel: { visible: true }
                    },
                    legend: { visible: false },
                    title: { visible: false }
                });
            }

            // Payment distribution chart
            const oPaymentChart = oView.byId("paymentDistChart");
            if (oPaymentChart) {
                oPaymentChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#E8743B", "#5899DA", "#19A979", "#945ECF"],
                        dataLabel: { visible: true, type: "percentage" }
                    },
                    legend: { visible: true, position: "right" },
                    title: { visible: false }
                });
            }

            // Aging chart
            const oAgingChart = oView.byId("agingAnalysisChart");
            if (oAgingChart) {
                oAgingChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#5899DA", "#E8743B"],
                        dataLabel: { visible: true }
                    },
                    legend: { visible: true, position: "bottom" },
                    title: { visible: false }
                });
            }

            // Sentiment chart
            const oSentimentChart = oView.byId("sentimentDistChart");
            if (oSentimentChart) {
                oSentimentChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#19A979", "#E8743B", "#ED4A7B"],
                        dataLabel: { visible: true, type: "percentage" }
                    },
                    legend: { visible: true, position: "right" },
                    title: { visible: false }
                });
            }

            // Call outcomes chart
            const oOutcomesChart = oView.byId("callOutcomesChart");
            if (oOutcomesChart) {
                oOutcomesChart.setVizProperties({
                    plotArea: {
                        colorPalette: ["#5899DA"],
                        dataLabel: { visible: true }
                    },
                    legend: { visible: false },
                    title: { visible: false }
                });
            }
        },

        loadAllStatistics: function () {
            this.loadOverviewStats();
            this.loadOutreachTimeline();
            this.loadPaymentDistribution();
            this.loadAgingAnalysis();
            this.loadStageDistribution();
            this.loadCallAnalytics();
            this.loadTopPayers();
            this.loadRecentActivity();
            
            // Update timestamp
            const oStatsModel = this.getView().getModel("stats");
            oStatsModel.setProperty("/lastUpdated", new Date().toLocaleString());
        },

        loadOverviewStats: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getOverviewStats(...)");

            oCreateContext.execute().then(() => {
                const oData = oCreateContext.getBoundContext().getObject();
                const oStatsModel = this.getView().getModel("stats");
                
                oStatsModel.setProperty("/totalPayers", oData.totalPayers || 0);
                oStatsModel.setProperty("/totalOutstanding", oData.totalOutstanding || 0);
                oStatsModel.setProperty("/totalOutstandingFormatted", this._formatCurrency(oData.totalOutstanding));
                oStatsModel.setProperty("/callsToday", oData.callsToday || 0);
                oStatsModel.setProperty("/emailsToday", oData.emailsToday || 0);
                oStatsModel.setProperty("/smsToday", oData.smsToday || 0);
                oStatsModel.setProperty("/successRate", oData.successRate || 0);
                oStatsModel.setProperty("/totalRecords", oData.totalPayers || 0);
            }).catch((oError) => {
                console.error("Error loading overview stats:", oError);
            });

            // Load pending followups count
            this._loadPendingFollowups();
        },

        _loadPendingFollowups: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oListBinding = oModel.bindList("/ScheduledFollowups", null, null, null, {
                $filter: "status eq 'pending'"
            });

            oListBinding.requestContexts(0, 1000).then((aContexts) => {
                this.getView().getModel("stats").setProperty("/pendingFollowups", aContexts.length);
            }).catch(() => {
                this.getView().getModel("stats").setProperty("/pendingFollowups", 0);
            });
        },

        _formatCurrency: function (value) {
            if (!value) return "0";
            if (value >= 1000000) {
                return (value / 1000000).toFixed(1) + "M";
            } else if (value >= 1000) {
                return (value / 1000).toFixed(1) + "K";
            }
            return value.toFixed(0);
        },

        loadOutreachTimeline: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getOutreachTimeline(...)");
            oCreateContext.setParameter("days", 30);

            oCreateContext.execute().then(() => {
                const oContext = oCreateContext.getBoundContext();
                const oData = oContext.getObject();
                const results = oData.value || (Array.isArray(oData) ? oData : []);
                const timelineData = this.transformTimelineData(results);
                this.getView().getModel("timeline").setData(timelineData);
            }).catch((oError) => {
                console.error("Error loading timeline:", oError);
            });
        },

        transformTimelineData: function (data) {
            const grouped = {};

            data.forEach(item => {
                const dateKey = item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date;
                if (!grouped[dateKey]) {
                    grouped[dateKey] = { date: dateKey, email: 0, call: 0, sms: 0 };
                }
                const type = (item.outreachType || '').toLowerCase();
                if (grouped[dateKey][type] !== undefined) {
                    grouped[dateKey][type] = item.count;
                }
            });

            return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
        },

        loadPaymentDistribution: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oCreateContext = oModel.bindContext("/getPaymentDistribution(...)");

            oCreateContext.execute().then(() => {
                const oData = oCreateContext.getBoundContext().getObject();
                const results = oData.value || (Array.isArray(oData) ? oData : []);
                this.getView().getModel("paymentDist").setData(results);
            }).catch((oError) => {
                console.error("Error loading payment distribution:", oError);
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
                console.error("Error loading aging analysis:", oError);
            });
        },

        loadStageDistribution: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oListBinding = oModel.bindList("/Payers");

            oListBinding.requestContexts(0, 1000).then((aContexts) => {
                const stageData = {};
                
                aContexts.forEach(oContext => {
                    const payer = oContext.getObject();
                    const stage = payer.Stage || 'UNKNOWN';
                    
                    if (!stageData[stage]) {
                        stageData[stage] = { stage: stage, count: 0, totalAmount: 0 };
                    }
                    stageData[stage].count++;
                    stageData[stage].totalAmount += payer.TotalPastDue || 0;
                });

                const sortOrder = ['STAGE_1', 'STAGE_2', 'STAGE_3'];
                const sortedData = Object.values(stageData).sort((a, b) => {
                    return sortOrder.indexOf(a.stage) - sortOrder.indexOf(b.stage);
                });

                this.getView().getModel("stageDist").setData(sortedData);
            }).catch((oError) => {
                console.error("Error loading stage distribution:", oError);
            });
        },

        loadCallAnalytics: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oListBinding = oModel.bindList("/CallTranscripts");

            oListBinding.requestContexts(0, 1000).then((aContexts) => {
                const sentimentData = { Positive: 0, Neutral: 0, Negative: 0 };
                const outcomeData = {};
                let promisesMade = 0;
                let disputesRaised = 0;
                let totalSentiment = 0;
                let sentimentCount = 0;

                aContexts.forEach(oContext => {
                    const call = oContext.getObject();
                    
                    // Sentiment analysis
                    const score = call.sentimentScore || 0.5;
                    totalSentiment += score;
                    sentimentCount++;

                    if (score >= 0.6) {
                        sentimentData.Positive++;
                    } else if (score >= 0.4) {
                        sentimentData.Neutral++;
                    } else {
                        sentimentData.Negative++;
                    }

                    // Outcomes
                    const conclusion = call.callConclusion || 'Unknown';
                    const shortConclusion = conclusion.length > 30 ? conclusion.substring(0, 30) + '...' : conclusion;
                    if (!outcomeData[shortConclusion]) {
                        outcomeData[shortConclusion] = { outcome: shortConclusion, count: 0 };
                    }
                    outcomeData[shortConclusion].count++;

                    // Promises and disputes
                    if (call.paymentPromiseDate) promisesMade++;
                    if (call.disputeRaised) disputesRaised++;
                });

                // Update sentiment chart
                const sentimentArray = Object.keys(sentimentData).map(key => ({
                    sentiment: key,
                    count: sentimentData[key]
                }));
                this.getView().getModel("sentiment").setData(sentimentArray);

                // Update outcomes chart (top 5)
                const outcomesArray = Object.values(outcomeData)
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5);
                this.getView().getModel("callOutcomes").setData(outcomesArray);

                // Update stats
                const oStatsModel = this.getView().getModel("stats");
                oStatsModel.setProperty("/promisesMade", promisesMade);
                oStatsModel.setProperty("/disputesRaised", disputesRaised);
                
                const avgSentiment = sentimentCount > 0 ? totalSentiment / sentimentCount : 0;
                oStatsModel.setProperty("/avgSentimentValue", avgSentiment);
                oStatsModel.setProperty("/avgSentiment", (avgSentiment * 100).toFixed(0) + "%");

            }).catch((oError) => {
                console.error("Error loading call analytics:", oError);
            });
        },

        loadTopPayers: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oListBinding = oModel.bindList("/Payers", null, [
                new sap.ui.model.Sorter("TotalPastDue", true)
            ]);

            oListBinding.requestContexts(0, 10).then((aContexts) => {
                const topPayers = aContexts.map((oContext, index) => {
                    const payer = oContext.getObject();
                    return {
                        rank: index + 1,
                        PayerId: payer.PayerId,
                        PayerName: payer.PayerName,
                        TotalPastDue: payer.TotalPastDue,
                        Currency: payer.Currency || 'USD',
                        MaxDaysPastDue: payer.MaxDaysPastDue,
                        Stage: payer.Stage,
                        LastOutreachStatus: payer.LastOutreachStatus || 'None'
                    };
                });

                this.getView().getModel("topPayers").setData(topPayers);
            }).catch((oError) => {
                console.error("Error loading top payers:", oError);
            });
        },

        loadRecentActivity: function () {
            const oModel = this.getOwnerComponent().getModel();
            const oListBinding = oModel.bindList("/OutreachHistory", null, [
                new sap.ui.model.Sorter("outreachDate", true)
            ], null, {
                $expand: "payer"
            });

            oListBinding.requestContexts(0, 10).then((aContexts) => {
                const activities = aContexts.map(oContext => {
                    const item = oContext.getObject();
                    const payerName = item.payer?.PayerName || 'Unknown';
                    return {
                        type: item.outreachType || 'outreach',
                        description: `${item.outreachType} to ${payerName} - ${item.status}`,
                        timestamp: new Date(item.outreachDate).toLocaleString()
                    };
                });

                this.getView().getModel("activity").setData(activities);
            }).catch((oError) => {
                console.error("Error loading recent activity:", oError);
            });
        },

        // ==================== NAVIGATION ====================
        
        onNavToCustomers: function () {
            this.getOwnerComponent().getRouter().navTo("main");
        },

        onNavToFollowups: function () {
            this.getOwnerComponent().getRouter().navTo("followups");
        },

        onNavToCallHistory: function () {
            this.getOwnerComponent().getRouter().navTo("callHistory");
        },

        onRefresh: function () {
            MessageToast.show("Refreshing dashboard...");
            this.loadAllStatistics();
        },

        onNavBack: function () {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("main", {}, true);
            }
        },

        // ==================== TILE PRESS HANDLERS ====================

        onTilePress: function () {
            this.onNavToCustomers();
        },

        onOutstandingPress: function () {
            this.onNavToCustomers();
        },

        onCallsPress: function () {
            this.onNavToCallHistory();
        },

        onEmailsPress: function () {
            MessageToast.show("Email analytics coming soon!");
        },

        onSuccessRatePress: function () {
            MessageToast.show("Success rate breakdown coming soon!");
        },

        // ==================== CHART INTERACTIONS ====================

        onStageChartTypeChange: function (oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            const oChart = this.byId("stageDistChart");
            
            if (sKey === "donut") {
                oChart.setVizType("donut");
            } else if (sKey === "bar") {
                oChart.setVizType("bar");
            }
        },

        onTimelineChartTypeChange: function (oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            const oChart = this.byId("outreachTimelineChart");
            
            switch (sKey) {
                case "line":
                    oChart.setVizType("line");
                    break;
                case "area":
                    oChart.setVizType("area");
                    break;
                case "bar":
                    oChart.setVizType("stacked_column");
                    break;
            }
        },

        onChartSelectData: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Selected: " + JSON.stringify(selectedData));
            }
        },

        onTimelineSelect: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Date: " + selectedData.Date);
            }
        },

        onPaymentChartSelect: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Status: " + selectedData.Status + " - Count: " + selectedData.Count);
            }
        },

        onAgingChartSelect: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Age Bucket: " + selectedData["Age Bucket"]);
            }
        },

        onSentimentSelect: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Sentiment: " + selectedData.Sentiment + " - Calls: " + selectedData.Calls);
            }
        },

        onOutcomeSelect: function (oEvent) {
            const aData = oEvent.getParameter("data");
            if (aData && aData.length > 0) {
                const selectedData = aData[0].data;
                MessageToast.show("Outcome: " + selectedData.Outcome);
            }
        },

        // ==================== TABLE INTERACTIONS ====================

        onTopPayerPress: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext("topPayers");
            const sPayerId = oContext.getProperty("PayerId");
            
            this.getOwnerComponent().getRouter().navTo("detail", {
                PayerId: sPayerId
            });
        },

        onQuickCall: function (oEvent) {
            const oContext = oEvent.getSource().getParent().getBindingContext("topPayers");
            const sPayerName = oContext.getProperty("PayerName");
            const sPayerId = oContext.getProperty("PayerId");

            MessageBox.confirm("Initiate call to " + sPayerName + "?", {
                title: "Quick Call",
                onClose: (sAction) => {
                    if (sAction === MessageBox.Action.OK) {
                        // Navigate to detail page and trigger call
                        this.getOwnerComponent().getRouter().navTo("detail", {
                            PayerId: sPayerId
                        });
                        MessageToast.show("Navigating to initiate call...");
                    }
                }
            });
        }
    });
});
