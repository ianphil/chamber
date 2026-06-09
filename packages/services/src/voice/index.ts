export { VoiceDictationService, type VoiceDictationServiceOptions, type VoiceWorkerPoolPort } from './VoiceDictationService';
export { VoiceDictationStore, coerceVoiceDictationConfig, type VoiceDictationStoreOptions } from './VoiceDictationStore';
export { VoiceWorkerPool, type VoiceWorkerLike, type VoiceWorkerPoolOptions, type VoiceWorkerPoolScheduler } from './VoiceWorkerPool';
export { FAKE_SENTINEL_TRANSCRIPT, FakeTranscriptionProvider, type FakeTranscriptionProviderOptions } from './providers/FakeTranscriptionProvider';
export { FoundryTranscriptionProvider, type FoundryTranscriptionProviderOptions } from './providers/FoundryTranscriptionProvider';
export type { TranscriptionProvider, TranscriptionProviderFactory, TranscriptionProviderStartOptions } from './providers/types';
export type { PermissionInspector } from './permissions/types';
