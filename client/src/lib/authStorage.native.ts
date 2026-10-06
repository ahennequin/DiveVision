// Android/iOS have no localStorage; expo-sqlite installs a persistent one.
import 'expo-sqlite/localStorage/install';

export const authStorage = globalThis.localStorage;
