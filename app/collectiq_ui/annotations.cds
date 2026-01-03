using CollectIQService as service from '../../srv/service';

annotate service.Payers with @(
    // Filter bar settings
    UI.SelectionFields : [
        payerId,
        stage
    ],
    // Table columns
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: payerId, Label: 'Payer ID' },
        { $Type: 'UI.DataField', Value: payerName, Label: 'Customer Name' },
        { $Type: 'UI.DataField', Value: totalPastDue, Label: 'Total Past Due' },
        { $Type: 'UI.DataField', Value: stage, Label: 'Risk Stage' },
        { $Type: 'UI.DataField', Value: lastOutreachStatus, Label: 'Outreach Status' },
        // AI Action Button on each row
        { 
            $Type: 'UI.DataFieldForAction', 
            Action: 'CollectIQService.generateOutreach', 
            Label: 'Generate AI Draft',
            InvocationGrouping: #Isolated 
        }
    ],
    // Header for Object Page
    UI.HeaderInfo : {
        TypeName: 'Payer',
        TypeNamePlural: 'Payers',
        Title: { Value: payerName },
        Description: { Value: payerId }
    },
    // Object Page Content
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneralInfo',
            Label : 'General Information',
            Target : '@UI.FieldGroup#General'
        }
    ],
    UI.FieldGroup #General : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { Value : payerId, Label: 'Payer ID' },
            { Value : payerName, Label: 'Customer Name' },
            { Value : totalPastDue, Label: 'Total Past Due' },
            { Value : stage, Label: 'Risk Stage' },
            { Value : latestOutreachDraft, Label: 'AI Generated Draft' }
        ]
    }
);

// Global Sync Button (Top of the page)
annotate service.CollectIQService with @(
    UI.Identification : [
        { $Type: 'UI.DataFieldForAction', Action: 'CollectIQService.syncAR', Label: 'Sync from S/4HANA' }
    ]
);