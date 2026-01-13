using { my.collectiq as my } from '../db/schema';
using { ZUI_COLLECTIQ_04 as external } from './external/ZUI_COLLECTIQ_04';

service CollectIQService {
    @readonly
    entity InvoicesS4 as projection on external.Invoices;

    entity Payers as projection on my.Payers actions {
        action generateOutreach() returns LargeString;
        action sendOutreach()     returns String; // Ab ye UI ko dikhega
    };

    entity Invoices as projection on my.Invoices;
    entity OutreachHistory as projection on my.OutreachHistory;

    action syncAR() returns String;
}