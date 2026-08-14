export async function chooseTauriFigSavePath() {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({
    defaultPath: 'Untitled.fig',
    filters: [{ name: 'Figma file', extensions: ['fig'] }]
  })
}
