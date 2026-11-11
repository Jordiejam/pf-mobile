import { useState } from 'react';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, confirm, Empty, Field, Row, Rows, Screen, Sheet, T, Toggle } from '@/ui/kit';

type Editing = { id?: string; name: string; includeNew: boolean; accountIds: Set<string> };

/** Saved account views: named selections of accounts with their own totals. */
export default function ViewsScreen() {
  const ledger = useLedger();
  const data = useLive((live) => ({
    views: live.views.list().map((view) => ({ ...view, accountIds: live.views.accountIds(view.id) })),
    accounts: live.accounts.list(),
  }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const toggle = (accountId: string) => {
    const accountIds = new Set(editing!.accountIds);
    if (!accountIds.delete(accountId)) accountIds.add(accountId);
    setEditing({ ...editing!, accountIds });
  };

  return (
    <Screen>
      {data.views.length === 0 ? (
        <Empty icon="funnel-outline" title="No views yet" hint={'A view totals a set of accounts you choose, such as "Spending money" or "Credit card cover". Home always shows everything.'} />
      ) : (
        <Card>
          <Rows>
            {data.views.map((view) => (
              <Row
                key={view.id} title={view.name}
                subtitle={`${view.accountIds.length} account${view.accountIds.length === 1 ? '' : 's'}${view.include_new ? ' · new accounts join' : ''}`}
                onPress={() => setEditing({ id: view.id, name: view.name, includeNew: !!view.include_new, accountIds: new Set(view.accountIds) })}
              />
            ))}
          </Rows>
        </Card>
      )}
      <Button title="Add view" icon="add" kind="secondary" onPress={() => setEditing({ name: '', includeNew: false, accountIds: new Set() })} />

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit view' : 'New view'}>
        <Field label="Name" value={editing?.name ?? ''} onChangeText={(name) => setEditing({ ...editing!, name })} autoCapitalize="words" />
        <T variant="label">Accounts</T>
        <Card>
          <Rows>
            {data.accounts.map((account) => (
              <Toggle key={account.id} title={account.name} value={!!editing?.accountIds.has(account.id)} onChange={() => toggle(account.id)} />
            ))}
          </Rows>
        </Card>
        <Card>
          <Toggle title="Include new accounts" subtitle="Accounts you add later join this view automatically" value={!!editing?.includeNew} onChange={(includeNew) => setEditing({ ...editing!, includeNew })} />
        </Card>
        <Button
          title="Save"
          onPress={() => attempt(() => ledger.views.save({ name: editing!.name, include_new: editing!.includeNew, account_ids: [...editing!.accountIds] }, editing!.id)) && setEditing(null)}
        />
        {editing?.id && (
          <Button
            title="Delete view" kind="danger"
            onPress={() => confirm('Delete this view?', 'The accounts in it are not affected.', 'Delete', () => {
              ledger.views.delete(editing.id!);
              setEditing(null);
            })}
          />
        )}
      </Sheet>
    </Screen>
  );
}
