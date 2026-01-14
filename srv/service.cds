using { my.collectiq as my } from '../db/schema';
// 1. Reference the new V4 service correctly
using { ZUI_COLLECTIQ_V4 as external } from './external/ZUI_COLLECTIQ_V4';

service CollectIQService {
    @readonly
    // 2. Changed from external.Invoices (plural) to external.Invoice (singular) 
    // to match your V4 metadata EntitySet name
    entity InvoicesS4 as projection on external.Invoice;

    entity Payers as projection on my.Payers actions {
        action generateOutreach() returns LargeString;
        action sendOutreach()     returns String;
    };

    entity Invoices as projection on my.Invoices;
    entity OutreachHistory as projection on my.OutreachHistory;

    action syncAR() returns String;
}