/**
 * Barrel re-export — backward compatibility shim.
 *
 * The real connection store has moved to:
 *   src/connections/store/connectionStore.ts
 *
 * All existing imports from 'src/henry/connectionStore' continue to work
 * without changes. New code should import from the canonical location.
 */

export * from '../connections/store/connectionStore';
export * from '../connections/store/connectionSelectors';
