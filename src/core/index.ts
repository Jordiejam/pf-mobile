import { AccountService } from './accounts';
import { AuditLog } from './audit';
import { BackupService } from './backup';
import { CaptureService } from './capture';
import { CardService } from './cards';
import { CategoryService } from './categories';
import { ChangeService } from './changes';
import { Store, type Db, type Environment } from './db';
import { RateService } from './fx';
import { LedgerService } from './ledger';
import { ReportService } from './reports';
import { migrate } from './schema';
import { seedDefaults } from './seed';
import { SettingsService } from './settings';
import { ValuationService } from './valuations';
import { ViewService } from './views';

/**
 * The whole ledger behind one object. Screens, the assistant and schedules all reach the
 * data through these services and nothing else.
 */
export class Ledger {
  readonly store: Store;
  readonly settings: SettingsService;
  readonly audit: AuditLog;
  readonly rates: RateService;
  readonly accounts: AccountService;
  readonly views: ViewService;
  readonly categories: CategoryService;
  readonly entries: LedgerService;
  readonly cards: CardService;
  readonly valuations: ValuationService;
  readonly capture: CaptureService;
  readonly reports: ReportService;
  readonly changes: ChangeService;
  readonly backup: BackupService;

  constructor(db: Db, env: Environment) {
    this.store = new Store(db, env);
    this.settings = new SettingsService(this.store);
    this.audit = new AuditLog(this.store);
    this.rates = new RateService(this.store);
    this.accounts = new AccountService(this.store, this.audit, this.rates);
    this.views = new ViewService(this.store);
    this.categories = new CategoryService(this.store, this.audit);
    this.entries = new LedgerService(this.store, this.audit, this.accounts, this.categories, this.rates);
    this.cards = new CardService(this.store, this.accounts);
    this.valuations = new ValuationService(this.store, this.audit, this.accounts);
    this.capture = new CaptureService(this.store, this.audit, this.entries);
    this.reports = new ReportService(this.store, this.entries, this.accounts, this.rates);
    this.changes = new ChangeService(this.store, this.audit, this.entries, this.valuations, this.accounts);
    this.backup = new BackupService(this.store);
  }

  /** Opens a database: upgrades its schema and, the first time, adds starting categories. */
  static open(db: Db, env: Environment): Ledger {
    migrate(db);
    const ledger = new Ledger(db, env);
    if (!ledger.settings.get('seeded')) seedDefaults(ledger);
    return ledger;
  }
}

export * from './accounts';
export * from './audit';
export * from './backup';
export * from './capture';
export * from './cards';
export * from './categories';
export * from './changes';
export { LedgerError, type Db, type Environment } from './db';
export * from './fx';
export * from './ledger';
export * from './money';
export * from './reports';
export * from './settings';
export * from './time';
export * from './valuations';
export * from './views';
export { seedDefaults, seedDemo } from './seed';
