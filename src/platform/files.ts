import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** Hands a text file to the person: the share sheet on a phone, a download in a browser. */
export async function shareTextFile(name: string, contents: string) {
  if (Platform.OS === 'web') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name });
  } finally {
    // The copy in the cache is not left lying around once it has been shared.
    if (file.exists) file.delete();
  }
}

/** Lets the person choose a file and returns its text, or null if they cancelled. */
export async function pickTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web') return asset.file ? asset.file.text() : (await fetch(asset.uri)).text();
  const file = new File(asset.uri);
  try {
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}
