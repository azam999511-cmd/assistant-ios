const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chat: (messages, extra) => ipcRenderer.invoke('chat', { messages, extra }),
  cancel: () => ipcRenderer.send('chat:cancel'),
  tts: (t) => ipcRenderer.invoke('tts', t),
  stt: (b, o) => ipcRenderer.invoke('stt', b, o),
  extract: (ab, name) => ipcRenderer.invoke('extract', ab, name),
  titleGen: (t) => ipcRenderer.invoke('title', t),
  archive: (ab, kind) => ipcRenderer.invoke('archive', ab, kind),
  getSettings: () => ipcRenderer.invoke('get'),
  saveSettings: (s) => ipcRenderer.invoke('save', s),
  getChats: () => ipcRenderer.invoke('chats:get'),
  setChats: (c) => ipcRenderer.invoke('chats:set', c),
  onTimer: (f) => ipcRenderer.on('timer', (_, t) => f(t)),
  onChatsChanged: (f) => ipcRenderer.on('chats:changed', () => f()),
  sync: { info: () => ipcRenderer.invoke('sync:info'), regen: () => ipcRenderer.invoke('sync:regen') },
  win: {
    mode: () => ipcRenderer.invoke('win:mode'),
    min: () => ipcRenderer.send('win:min'),
    max: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
    bounds: () => ipcRenderer.invoke('win:bounds'),
    setBounds: (b) => ipcRenderer.send('win:setBounds', b),
    relaunch: () => ipcRenderer.send('app:relaunch'),
    onState: (f) => ipcRenderer.on('win:state', (_, s) => f(s))
  }
});
