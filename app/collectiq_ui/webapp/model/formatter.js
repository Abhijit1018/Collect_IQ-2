sap.ui.define([], function () {
    "use strict";

    return {
        /**
         * Formats currency values
         * @param {number} value - The numeric value to format
         * @returns {string} Formatted currency string
         */
        formatCurrency: function (value) {
            if (value === null || value === undefined) {
                return "0.00";
            }
            return parseFloat(value).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        },

        /**
         * Formats date values
         * @param {string} value - The date string or timestamp
         * @returns {string} Formatted date string
         */
        formatDate: function (value) {
            if (!value) {
                return "";
            }
            var oDate = new Date(value);
            if (isNaN(oDate.getTime())) {
                return value;
            }
            return oDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        },

        /**
         * Formats datetime values
         * @param {string} value - The datetime string or timestamp
         * @returns {string} Formatted datetime string
         */
        formatDateTime: function (value) {
            if (!value) {
                return "";
            }
            var oDate = new Date(value);
            if (isNaN(oDate.getTime())) {
                return value;
            }
            return oDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        /**
         * Returns criticality state based on days past due
         * @param {number} days - Days past due
         * @returns {string} State value
         */
        getCriticalityState: function (days) {
            if (days > 60) {
                return "Error";
            } else if (days > 30) {
                return "Warning";
            }
            return "Success";
        },

        /**
         * Returns stage state
         * @param {string} stage - Stage value
         * @returns {string} State value
         */
        getStageState: function (stage) {
            switch (stage) {
                case "STAGE_3":
                    return "Error";
                case "STAGE_2":
                    return "Warning";
                case "STAGE_1":
                case "RESOLVED":
                    return "Success";
                default:
                    return "Information";
            }
        },

        /**
         * Returns outreach status state
         * @param {string} status - Status value
         * @returns {string} State value
         */
        getOutreachStatusState: function (status) {
            switch (status) {
                case "SENT":
                    return "Success";
                case "PENDING":
                    return "Warning";
                case "FAILED":
                    return "Error";
                default:
                    return "None";
            }
        },

        /**
         * Truncates text to specified length
         * @param {string} text - Text to truncate
         * @param {number} maxLength - Maximum length
         * @returns {string} Truncated text
         */
        truncateText: function (text, maxLength) {
            if (!text) {
                return "";
            }
            maxLength = maxLength || 100;
            if (text.length <= maxLength) {
                return text;
            }
            return text.substring(0, maxLength) + "...";
        }
    };
});
