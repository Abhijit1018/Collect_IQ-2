sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("my.collectiq.controller.ShadowMode", {
        onInit: function () {
            // Local model for chat history
            var oChatModel = new JSONModel({
                messages: [],
                isTyping: false
            });
            this.getView().setModel(oChatModel, "chat");
            this._oRouter = sap.ui.core.UIComponent.getRouterFor(this);
        },

        onNavBack: function () {
            this._oRouter.navTo("dashboard");
        },

        onPayerSelect: function (oEvent) {
            var oContext = oEvent.getParameter("listItem").getBindingContext();
            this.getView().setBindingContext(oContext);

            // Clear chat on new payer
            this.getView().getModel("chat").setProperty("/messages", []);
            MessageToast.show("Switched to customer: " + oContext.getProperty("PayerName"));
        },

        onSendMessage: function () {
            var oView = this.getView();
            var oInput = oView.byId("chatInput");
            var sText = oInput.getValue();
            var oContext = oView.getBindingContext();

            if (!sText || !sText.trim()) return;
            if (!oContext) {
                MessageToast.show("Please select a customer first.");
                return;
            }

            var sPayerId = oContext.getProperty("PayerId");
            var oChatModel = oView.getModel("chat");
            var aMessages = oChatModel.getProperty("/messages");

            // 1. Add User Message
            aMessages.push({ sender: "User", text: sText });
            oChatModel.setProperty("/messages", aMessages);
            oInput.setValue("");

            // 2. Call Simulation Endpoint
            oChatModel.setProperty("/isTyping", true);

            var sUrl = "/collect-iq/chat-simulation"; // Relative URL -> handled by approuter/server
            // If running UI5 locally with proxy, might need adjustments, but standard CAP serves both.

            // Determine absolute URL if needed (for local UI testing against separate server)
            // Assuming standard integrated deployment or proxy

            fetch(sUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: sText,
                    payerId: sPayerId
                })
            })
                .then(res => res.json())
                .then(data => {
                    var sResponse = data.response || "Error: No response from AI.";
                    if (data.error) {
                        if (data.error.includes("429") || data.error.includes("Quota exceeded")) {
                            sResponse = "⚠️ system: Rate limit exceeded (Google Gemini Free Tier). Please wait 30-60 seconds and try again.";
                        } else {
                            sResponse = "System Error: " + data.error;
                        }
                    }

                    var aCurrentMsgs = oChatModel.getProperty("/messages");
                    aCurrentMsgs.push({ sender: "AI", text: sResponse });
                    oChatModel.setProperty("/messages", aCurrentMsgs);
                })
                .catch(err => {
                    var aCurrentMsgs = oChatModel.getProperty("/messages");
                    aCurrentMsgs.push({ sender: "AI", text: "Network Error: " + err.message });
                    oChatModel.setProperty("/messages", aCurrentMsgs);
                })
                .finally(() => {
                    oChatModel.setProperty("/isTyping", false);
                    this._scrollToBottom();
                });
        },

        _scrollToBottom: function () {
            // Simple timeout to allow rendering
            setTimeout(() => {
                var oContainer = this.getView().byId("chatContainer");
                // Access internal DOM ref to scroll
                var oDomRef = oContainer.getDomRef();
                if (oDomRef) {
                    // Scroll to bottom of the 'sapMScrollContScroll' div
                    var oScrollDiv = oDomRef.querySelector(".sapMScrollContScroll");
                    if (oScrollDiv) {
                        oScrollDiv.scrollTop = oScrollDiv.scrollHeight;
                    }
                }
            }, 100);
        }
    });
});
