sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"collectiqui/test/integration/pages/PayersList",
	"collectiqui/test/integration/pages/PayersObjectPage"
], function (JourneyRunner, PayersList, PayersObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('collectiqui') + '/test/flp.html#app-preview',
        pages: {
			onThePayersList: PayersList,
			onThePayersObjectPage: PayersObjectPage
        },
        async: true
    });

    return runner;
});

