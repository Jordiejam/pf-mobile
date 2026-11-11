import { useState } from 'react';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, confirm, Field, Row, Rows, Screen, Sheet, T } from '@/ui/kit';

/** Groups only organise the Accounts screen; an account's behaviour is its own type. */
export default function GroupsScreen() {
  const ledger = useLedger();
  const groups = useLive((live) => {
    const accounts = live.accounts.list({ archived: true });
    return live.accounts.groups().map((group) => ({ ...group, count: accounts.filter((account) => account.group_id === group.id).length }));
  });
  const [editing, setEditing] = useState<{ id?: string; name: string } | null>(null);

  return (
    <Screen>
      <Card>
        <Rows>
          {groups.map((group) => (
            <Row key={group.id} title={group.name} value={group.count ? `${group.count} account${group.count > 1 ? 's' : ''}` : 'Empty'} onPress={() => setEditing(group)} />
          ))}
        </Rows>
      </Card>
      <Button title="Add group" icon="add" kind="secondary" onPress={() => setEditing({ name: '' })} />
      <T variant="small" muted>To move an account to another group, edit the account.</T>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Rename group' : 'New group'}>
        <Field label="Name" value={editing?.name ?? ''} onChangeText={(name) => setEditing({ ...editing, name })} autoFocus autoCapitalize="words" />
        <Button title="Save" onPress={() => attempt(() => ledger.accounts.saveGroup(editing!.name, editing!.id)) && setEditing(null)} />
        {editing?.id && (
          <Button
            title="Delete group" kind="danger"
            onPress={() => confirm('Delete this group?', 'Only an empty group can be deleted.', 'Delete', () => {
              if (attempt(() => ledger.accounts.deleteGroup(editing.id!))) setEditing(null);
            })}
          />
        )}
      </Sheet>
    </Screen>
  );
}
