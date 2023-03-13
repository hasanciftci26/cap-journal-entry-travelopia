using {JournalEntries as JE} from '../db/data-models';

service JournalEntryReferences @(impl : './data-provider') {
    entity JournalEntries as projection on JE;
};
