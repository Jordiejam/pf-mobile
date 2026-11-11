import { useState } from 'react';
import { View } from 'react-native';
import type { Category, CategoryKind } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, Choice, confirm, Field, PickerSheet, Row, Rows, Screen, Segmented, Sheet, T, Toggle } from '@/ui/kit';

const KINDS: { value: CategoryKind; label: string }[] = [
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
];

type Editing = { existing?: Category; name: string; parentId: string | null };

export default function CategoriesScreen() {
  const ledger = useLedger();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState(false);
  const categories = useLive((live) => live.categories.list({ kind, archived: showArchived }).filter((category) => !category.system_key), [kind, showArchived]);
  const parents = categories.filter((category) => !category.parent_id);

  const save = () => {
    const ok = attempt(() =>
      ledger.categories.save({ name: editing!.name, kind, parent_id: editing!.parentId }, editing!.existing),
    );
    if (ok) setEditing(null);
  };

  return (
    <Screen>
      <Segmented options={KINDS} value={kind} onChange={setKind} />
      {parents.map((parent) => (
        <Card key={parent.id}>
          <Rows>
            {[parent, ...categories.filter((category) => category.parent_id === parent.id)].map((category) => (
              <Row
                key={category.id}
                title={`${category.parent_id ? '      ' : ''}${category.name}`}
                value={category.archived ? 'Archived' : undefined}
                onPress={() => setEditing({ existing: category, name: category.name, parentId: category.parent_id })}
                dense
              />
            ))}
          </Rows>
        </Card>
      ))}
      <Button title="Add category" icon="add" kind="secondary" onPress={() => setEditing({ name: '', parentId: null })} />
      <Card>
        <Toggle title="Show archived" value={showArchived} onChange={setShowArchived} />
      </Card>
      <T variant="small" muted>Renaming or moving a category updates past reports too; your transactions are not changed.</T>

      <Sheet visible={!!editing && !picking} onClose={() => setEditing(null)} title={editing?.existing ? 'Edit category' : 'New category'}>
        <Field label="Name" value={editing?.name ?? ''} onChangeText={(name) => setEditing({ ...editing!, name })} autoFocus={!editing?.existing} autoCapitalize="sentences" />
        <Choice
          label="Inside" placeholder="Nothing (top level)" onPress={() => setPicking(true)}
          value={parents.find((parent) => parent.id === editing?.parentId)?.name ?? null}
        />
        <Button title="Save" onPress={save} />
        {editing?.existing && (
          <View style={{ gap: 10 }}>
            <Button
              title={editing.existing.archived ? 'Unarchive' : 'Archive'} kind="secondary"
              onPress={() => attempt(() => ledger.categories.setArchived(editing.existing!.id, !editing.existing!.archived)) && setEditing(null)}
            />
            <Button
              title="Delete" kind="danger"
              onPress={() => confirm('Delete this category?', 'Only a category that has never been used can be deleted.', 'Delete', () => {
                if (attempt(() => ledger.categories.delete(editing.existing!.id))) setEditing(null);
              })}
            />
          </View>
        )}
      </Sheet>
      <PickerSheet
        visible={picking} onClose={() => setPicking(false)} title="Inside" value={editing?.parentId ?? null}
        onPick={(parentId) => setEditing({ ...editing!, parentId })}
        options={[
          { value: null, label: 'Nothing (top level)' },
          ...parents.filter((parent) => parent.id !== editing?.existing?.id && !parent.archived).map((parent) => ({ value: parent.id as string | null, label: parent.name })),
        ]}
      />
    </Screen>
  );
}
