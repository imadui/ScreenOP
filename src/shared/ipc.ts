/** IPC channel names. Keep main, preload and renderer in sync through this single table. */
export const IPC = {
  appGetInfo: 'app:get-info',
  appNavigate: 'app:navigate',
  appNotice: 'app:notice',
  appLog: 'app:log',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',

  storageStatus: 'storage:status',
  storageChooseFolder: 'storage:choose-folder',
  storageUseAutomatic: 'storage:use-automatic',
  storageOpenFolder: 'storage:open-folder',
  storageRetryPending: 'storage:retry-pending',
  storageChanged: 'storage:changed',

  sourcesList: 'sources:list',
  sourcesRestore: 'sources:restore',

  libraryList: 'library:list',
  libraryRename: 'library:rename',
  libraryDelete: 'library:delete',
  libraryOpen: 'library:open',
  libraryShowInFolder: 'library:show-in-folder',
  libraryCopyPath: 'library:copy-path',
  libraryChanged: 'library:changed',
  librarySaveThumbnail: 'library:save-thumbnail',
  libraryTrimInfo: 'library:trim-info',
  libraryTrim: 'library:trim',
  libraryTrimProgress: 'library:trim-progress',

  cameraOpenBubble: 'camera:open-bubble',
  cameraCloseBubble: 'camera:close-bubble',
  cameraPlaceBubble: 'camera:place-bubble',
  cameraSetBubbleSize: 'camera:set-bubble-size',
  cameraStepBubble: 'camera:step-bubble',
  cameraChooseBackground: 'camera:choose-background',
  cameraBubbleStatus: 'camera:bubble-status',

  bubbleConfig: 'bubble:config',
  bubbleStep: 'bubble:step',
  bubbleShape: 'bubble:shape',
  bubbleClose: 'bubble:close',
  bubbleDrag: 'bubble:drag',
  bubbleStatus: 'bubble:status',
  bubbleReady: 'bubble:ready',

  shareProviders: 'share:providers',
  shareRun: 'share:run',

  recorderStart: 'recorder:start',
  recorderPause: 'recorder:pause',
  recorderResume: 'recorder:resume',
  recorderStop: 'recorder:stop',
  recorderDiscard: 'recorder:discard',
  recorderSetMicMuted: 'recorder:set-mic-muted',
  recorderSetCameraVisible: 'recorder:set-camera-visible',
  recorderGetState: 'recorder:get-state',
  recorderState: 'recorder:state',

  engineCommand: 'engine:command',
  engineResponse: 'engine:response',
  engineEvent: 'engine:event',
  engineChunk: 'engine:chunk',
  engineReady: 'engine:ready'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
