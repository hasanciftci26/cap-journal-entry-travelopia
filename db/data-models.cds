using {managed} from '@sap/cds/common';

entity JournalEntries : managed {
    key ID                    : UUID;
        accountingDocument    : String(20);
        companyCode           : String(4);
        fiscalYear            : String(4);
        journalEntry          : String(20);
        message               : String(200);
        isUpdatedSuccessfully : Boolean;
};
