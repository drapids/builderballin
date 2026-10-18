const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const on = (ch, fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('bbDesktop', {
  info: () => call('info'),
  game: {
    detect: () => call('game:detect'),
    pick: () => call('game:pick'),
    install: () => call('game:install'),
    play: (text, name) => call('game:play', text, name),
    folder: () => call('game:folder'),
    log: () => call('game:log')
  },
  file: {
    save: (text, name, existing) => call('file:save', text, name, existing),
    open: (p) => call('file:open', p),
    recent: () => call('file:recent'),
    forget: (p) => call('file:forget', p),
    reveal: (p) => call('file:reveal', p),
    sendToHyperboi: (text, name) => call('file:sendToHyperboi', text, name)
  },
  search: {
    find: (source, q, cursor) => call('search', source, q, cursor),
    get: (source, id) => call('search:get', source, id),
    token: (t) => call('search:token', t)
  },
  web: (url) => call('web:open', url),
  external: (url) => call('external', url),
  on
});
