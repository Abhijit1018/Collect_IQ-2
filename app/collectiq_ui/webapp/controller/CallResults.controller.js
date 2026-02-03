sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageToast, History) {
    "use strict";

    return Controller.extend("my.collectiq.controller.CallResults", {

        onInit: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("callResults").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            const sCallId = oEvent.getParameter("arguments").callId;
            this.loadCallDetails(sCallId);
        },

        loadCallDetails: function (sCallId) {
            const oModel = this.getOwnerComponent().getModel();
            const oContextBinding = oModel.bindContext("/getCallDetails(...)");
            oContextBinding.setParameter("callId", sCallId);

            oContextBinding.execute().then(() => {
                const oBoundContext = oContextBinding.getBoundContext();
                let result = oBoundContext.getObject();

                // Handle V4 return value wrapping
                if (result && result.value) {
                    result = result.value;
                }

                // Parse if string (due to LargeString return type)
                if (typeof result === 'string') {
                    try {
                        result = JSON.parse(result);
                    } catch (e) { console.error("Error parsing call details JSON", e); }
                }

                // Ensure result object structure
                if (!result || !result.call) {
                    console.warn("Call details structure unexpected", result);
                }

                // Parse key points JSON inside the call object if needed
                if (result && result.call && result.call.keyPoints) {
                    try {
                        result.keyPointsArray = JSON.parse(result.call.keyPoints);
                    } catch (e) { result.keyPointsArray = []; }
                }

                const oCallModel = new JSONModel(result);
                this.getView().setModel(oCallModel, "call");
            }).catch((oError) => {
                MessageToast.show("Error loading call details");
                console.error(oError);
            });
        },

        formatDuration: function (seconds) {
            if (!seconds) return "0m 0s";
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${minutes}m ${secs}s`;
        },

        formatSentimentPercent: function (score) {
            // Convert -1 to 1 scale to 0-100
            if (score === undefined || score === null) return 0;
            return ((parseFloat(score) + 1) / 2) * 100;
        },

        formatSentimentLabel: function (score) {
            if (score > 0.3) return "Positive";
            if (score > -0.3) return "Neutral";
            return "Negative";
        },

        formatSentimentState: function (score) {
            if (score > 0.3) return "Success";
            if (score > -0.3) return "Warning";
            return "Error";
        },

        formatSentimentDescription: function (score) {
            if (score > 0.3) return "Payer was cooperative and receptive";
            if (score > -0.3) return "Standard interaction";
            return "Payer was resistant or upset";
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

        onExportTranscript: function () {
            // TODO: Implement export functionality
            MessageToast.show("Export functionality coming soon");
        },

        onScheduleFollowUp: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("followups");
        }
    });
});
